// GoldenLand executable-first oracle.
// Build in a Win32 developer prompt, never an x64 prompt:
//   call "%ProgramFiles(x86)%\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Auxiliary\\Build\\vcvars32.bat"
//   cl /nologo /EHsc /W4 /O2 oracle.cpp bcrypt.lib gdi32.lib /link /MACHINE:X86 /SUBSYSTEM:CONSOLE
// Or build with LLVM-MinGW:
//   i686-w64-mingw32-clang++ oracle.cpp -std=c++17 -O2 -Wall -Wextra -municode -static -o native-oracle.exe -lbcrypt -lgdi32
// The source hard-fails outside x86 because the recovered ABI is i386 __cdecl/__thiscall.
// It loads the exact shipped DLLs, verifies SHA-256, captures API-table writes,
// and exposes a fail-closed HostAPI table. It intentionally does not launch
// GoldenLand.exe or create a window, DirectX device, audio device, or game loop.

#define WIN32_LEAN_AND_MEAN
#if !defined(_M_IX86) && !defined(__i386__)
#error "native-oracle must be compiled for Win32/x86"
#endif
#include <windows.h>
#include <bcrypt.h>
#include <d3d.h>
#include <intrin.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <string>
#include <vector>

#if defined(_MSC_VER)
#pragma comment(lib, "bcrypt.lib")
#pragma comment(lib, "gdi32.lib")
#endif

namespace {

constexpr size_t kHostSlots = 256;
constexpr size_t kModuleSlots = 1024;
constexpr GUID kD3DTnLHalDeviceGuid = {
    0xf5049e78, 0x4861, 0x11d2, { 0xa4, 0x07, 0x00, 0xa0, 0xc9, 0x06, 0x29, 0xa8 }
};
constexpr size_t kRawArgumentWords = 8;

struct ModuleSpec {
    const wchar_t* label;
    const wchar_t* defaultPath;
    const char* sha256;
    DWORD expectedSize;
    wchar_t resolvedPath[MAX_PATH]{};
};

const ModuleSpec kServer = {
    L"Server.dll", L"E:\\Games\\zlato22\\Server.dll",
    "418e256063748f2e90db35ae7c6abe6eac401fb86908cb5f27ebf565a21cc837", 589824,
};
const ModuleSpec kClient = {
    L"Client.dll", L"E:\\Games\\zlato22\\Client.dll",
    "fbf213b4b820e767a529556d0f7e4d29ee2202e7e39c3e49043f49d55dab5c16", 1331200,
};

#if defined(_MSC_VER)
#define ORACLE_THISCALL __thiscall
#define ORACLE_CDECL __cdecl
#define ORACLE_STDCALL __stdcall
#else
#define ORACLE_THISCALL __attribute__((thiscall))
#define ORACLE_CDECL __attribute__((cdecl))
#define ORACLE_STDCALL __attribute__((stdcall))
#endif

using GetApi = void (__cdecl*)(void*, void*);
using Initializer = void (__cdecl*)(void);
using NativeAgeEvaluate = double (ORACLE_THISCALL*)(void*, void*);

HMODULE g_server = nullptr;
struct OracleResource {
    std::vector<unsigned char> bytes;
    std::string requestedPath;
    size_t offset = 0;
};
std::string g_assetRoot = "G:\\ws\\zlato2\\public\\assets";
std::string g_gameRoot;
uintptr_t g_activeResource = 0;
std::vector<OracleResource> g_resources(1);
std::vector<std::string> g_userInterfaceSdb;
std::vector<uint8_t> g_userInterfaceSdbPresent;
bool g_userInterfaceSdbAttempted = false;
bool g_userInterfaceSdbValid = false;
bool g_captureAgeNodeAllocations = false;
std::vector<uintptr_t> g_ageNodeAllocations;
NativeAgeEvaluate g_nativeAgeEvaluate = nullptr;
NativeAgeEvaluate g_nativeAgeArgumentEvaluate = nullptr;
bool g_nativeTraceIsScr = false;
bool g_nativeAgeTraceEnabled = false;
unsigned g_nativeAgeTraceTurn = 0;
unsigned g_nativeAgeTraceDepth = 0;
unsigned g_nativeAgeEvaluationSequence = 0;
unsigned g_nativeAgeFlowStep = 0;
bool g_nativeSawScrCall = false;
double g_nativeLastScrCallResult = 0;
std::vector<double> g_nativeScrCallResults;

std::string narrowPath(const wchar_t* value) {
    std::string result;
    if (!value) return result;
    while (*value) result.push_back(static_cast<char>(*value++));
    return result;
}

bool readResourceFile(const std::string& path, std::vector<unsigned char>* bytes) {
    FILE* file = fopen(path.c_str(), "rb");
    if (!file) return false;
    if (fseek(file, 0, SEEK_END) != 0) { fclose(file); return false; }
    const long length = ftell(file);
    if (length < 0 || fseek(file, 0, SEEK_SET) != 0) { fclose(file); return false; }
    bytes->resize(static_cast<size_t>(length));
    const size_t read = bytes->empty() ? 0 : fread(bytes->data(), 1, bytes->size(), file);
    fclose(file);
    return read == bytes->size();
}
bool convertBmpToCsx(std::vector<unsigned char>* bytes) {
    if (!bytes || bytes->size() < 54 || (*bytes)[0] != 'B' || (*bytes)[1] != 'M') return false;
    auto u16 = [&](size_t offset) -> uint16_t {
        return static_cast<uint16_t>((*bytes)[offset]) | static_cast<uint16_t>((*bytes)[offset + 1] << 8);
    };
    auto u32 = [&](size_t offset) -> uint32_t {
        return static_cast<uint32_t>((*bytes)[offset])
            | (static_cast<uint32_t>((*bytes)[offset + 1]) << 8)
            | (static_cast<uint32_t>((*bytes)[offset + 2]) << 16)
            | (static_cast<uint32_t>((*bytes)[offset + 3]) << 24);
    };
    const uint32_t pixelOffset = u32(10);
    const int32_t width = static_cast<int32_t>(u32(18));
    const int32_t signedHeight = static_cast<int32_t>(u32(22));
    const uint16_t bitsPerPixel = u16(28);
    const uint32_t colorsUsed = u32(46);
    if (width <= 0 || signedHeight == 0 || bitsPerPixel != 8) return false;
    const uint32_t height = static_cast<uint32_t>(signedHeight < 0 ? -signedHeight : signedHeight);
    const uint32_t paletteSize = colorsUsed == 0 ? 256u : colorsUsed;
    const size_t paletteOffset = 54;
    const size_t paletteBytes = static_cast<size_t>(paletteSize) * 4;
    const size_t rowStride = (static_cast<size_t>(width) + 3u) & ~size_t(3u);
    if (paletteSize > 256 || paletteOffset + paletteBytes > bytes->size()
        || pixelOffset > bytes->size() || pixelOffset + rowStride * height > bytes->size()) return false;
    std::vector<unsigned char> converted;
    auto appendU32 = [&](uint32_t value) {
        converted.push_back(static_cast<unsigned char>(value));
        converted.push_back(static_cast<unsigned char>(value >> 8));
        converted.push_back(static_cast<unsigned char>(value >> 16));
        converted.push_back(static_cast<unsigned char>(value >> 24));
    };
    appendU32(paletteSize);
    converted.insert(converted.end(), bytes->begin() + paletteOffset, bytes->begin() + paletteOffset + 4);
    converted.insert(converted.end(), bytes->begin() + paletteOffset, bytes->begin() + paletteOffset + paletteBytes);
    appendU32(static_cast<uint32_t>(width));
    appendU32(height);
    const size_t indexTableOffset = converted.size();
    converted.resize(converted.size() + static_cast<size_t>(height + 1) * 4);
    const size_t compressedOffset = converted.size();
    for (uint32_t line = 0; line <= height; ++line) {
        const uint32_t lineOffset = line == height ? static_cast<uint32_t>(static_cast<size_t>(width) * height) : static_cast<uint32_t>(static_cast<size_t>(width) * line);
        const size_t at = indexTableOffset + static_cast<size_t>(line) * 4;
        converted[at] = static_cast<unsigned char>(lineOffset);
        converted[at + 1] = static_cast<unsigned char>(lineOffset >> 8);
        converted[at + 2] = static_cast<unsigned char>(lineOffset >> 16);
        converted[at + 3] = static_cast<unsigned char>(lineOffset >> 24);
    }
    converted.reserve(compressedOffset + static_cast<size_t>(width) * height);
    for (uint32_t line = 0; line < height; ++line) {
        const uint32_t sourceLine = signedHeight > 0 ? height - 1 - line : line;
        const size_t source = pixelOffset + static_cast<size_t>(sourceLine) * rowStride;
        converted.insert(converted.end(), bytes->begin() + source, bytes->begin() + source + width);
    }
    *bytes = std::move(converted);
    return true;
}

uintptr_t openAssetResource(uintptr_t pathPointer) {
    if (!pathPointer) return 0;
    const char* rawPath = reinterpret_cast<const char*>(pathPointer);
    std::string relativePath(rawPath);
    for (char& character : relativePath) if (character == '/') character = '\\';
    std::string alternatePath = relativePath;
    if (alternatePath.size() >= 4 && alternatePath.compare(alternatePath.size() - 4, 4, ".csx") == 0) {
        alternatePath.replace(alternatePath.size() - 4, 4, ".bmp");
    } else if (alternatePath.size() >= 4 && alternatePath.compare(alternatePath.size() - 4, 4, ".bmp") == 0) {
        alternatePath.replace(alternatePath.size() - 4, 4, ".csx");
    }
    const std::string candidates[] = {
        g_assetRoot + "\\" + relativePath,
        g_assetRoot + "\\" + alternatePath,
        g_gameRoot + "\\" + relativePath,
        g_gameRoot + "\\Data\\" + relativePath,
    };
    std::string logoFallback;
    if (relativePath.find("\\logos\\") != std::string::npos) {
        logoFallback = g_assetRoot + "\\engineres\\interface\\logos\\burut ct.bmp";
    }
    OracleResource resource;
    bool loaded = false;
    for (const std::string& candidate : candidates) {
        if (readResourceFile(candidate, &resource.bytes)) { loaded = true; break; }
    }
    resource.requestedPath = relativePath;
    if (relativePath.size() >= 4 && relativePath.compare(relativePath.size() - 4, 4, ".bmp") == 0
        && (resource.bytes.size() < 2 || resource.bytes[0] != 'B' || resource.bytes[1] != 'M')) {
        resource.bytes.assign(58 + 4, 0);
        resource.bytes[0] = 'B';
        resource.bytes[1] = 'M';
        *reinterpret_cast<uint32_t*>(resource.bytes.data() + 2) = static_cast<uint32_t>(resource.bytes.size());
        *reinterpret_cast<uint32_t*>(resource.bytes.data() + 10) = 54;
        *reinterpret_cast<uint32_t*>(resource.bytes.data() + 14) = 40;
        *reinterpret_cast<int32_t*>(resource.bytes.data() + 18) = 1;
        *reinterpret_cast<int32_t*>(resource.bytes.data() + 22) = 1;
        *reinterpret_cast<uint16_t*>(resource.bytes.data() + 26) = 1;
        *reinterpret_cast<uint16_t*>(resource.bytes.data() + 28) = 32;
        *reinterpret_cast<uint32_t*>(resource.bytes.data() + 34) = 4;
    }
    if (!loaded && !logoFallback.empty()) loaded = readResourceFile(logoFallback, &resource.bytes);
    if (loaded && relativePath.size() >= 4 && relativePath.compare(relativePath.size() - 4, 4, ".csx") == 0
        && resource.bytes.size() >= 2 && resource.bytes[0] == 'B' && resource.bytes[1] == 'M') {
        if (convertBmpToCsx(&resource.bytes)) {
            fprintf(stderr, "oracle_resource_convert bmp_to_csx path=%s bytes=0x%Ix\n", relativePath.c_str(), resource.bytes.size());
        }
    }
    if (!loaded) {
        fprintf(stderr, "oracle_resource_missing path=%s\n", relativePath.c_str());
        return 0;
    }
    g_resources.push_back(std::move(resource));
    return static_cast<uintptr_t>(g_resources.size() - 1);
}
HMODULE g_client = nullptr;

uintptr_t currentStackPointer() {
#if defined(_MSC_VER) && defined(_M_IX86)
    uintptr_t value = 0;
    __asm {
        mov value, esp
    }
    return value;
#elif defined(__GNUC__) && defined(__i386__)
    uintptr_t value = 0;
    __asm__ volatile("movl %%esp, %0" : "=r"(value));
    return value;
#else
    uintptr_t value = 0;
    return reinterpret_cast<uintptr_t>(&value);
#endif
}

const wchar_t* modulePath(const ModuleSpec& spec) {
    return spec.resolvedPath[0] ? spec.resolvedPath : spec.defaultPath;
}


LONG WINAPI oracleExceptionFilter(EXCEPTION_POINTERS* info) {
    const DWORD code = info && info->ExceptionRecord ? info->ExceptionRecord->ExceptionCode : 0;
    const uintptr_t address = info && info->ExceptionRecord ? reinterpret_cast<uintptr_t>(info->ExceptionRecord->ExceptionAddress) : 0;
    const uintptr_t instruction = info && info->ContextRecord ? static_cast<uintptr_t>(info->ContextRecord->Eip) : 0;
    const uintptr_t ebp = info && info->ContextRecord ? static_cast<uintptr_t>(info->ContextRecord->Ebp) : 0;
    const uintptr_t ebx = info && info->ContextRecord ? static_cast<uintptr_t>(info->ContextRecord->Ebx) : 0;
    const uintptr_t edi = info && info->ContextRecord ? static_cast<uintptr_t>(info->ContextRecord->Edi) : 0;
    const uintptr_t eax = info && info->ContextRecord ? static_cast<uintptr_t>(info->ContextRecord->Eax) : 0;
    const uintptr_t ecx = info && info->ContextRecord ? static_cast<uintptr_t>(info->ContextRecord->Ecx) : 0;
    const uintptr_t edx = info && info->ContextRecord ? static_cast<uintptr_t>(info->ContextRecord->Edx) : 0;
    const uintptr_t esi = info && info->ContextRecord ? static_cast<uintptr_t>(info->ContextRecord->Esi) : 0;
    const uintptr_t esp = info && info->ContextRecord ? static_cast<uintptr_t>(info->ContextRecord->Esp) : 0;
    auto readWords = [](uintptr_t pointer, uintptr_t* output, size_t byteCount) {
        MEMORY_BASIC_INFORMATION memory{};
        if (!pointer || VirtualQuery(reinterpret_cast<const void*>(pointer), &memory, sizeof(memory)) != sizeof(memory)) return false;
        const uintptr_t regionEnd = reinterpret_cast<uintptr_t>(memory.BaseAddress) + memory.RegionSize;
        const bool readable = memory.State == MEM_COMMIT
            && (memory.Protect & (PAGE_NOACCESS | PAGE_GUARD)) == 0
            && pointer <= regionEnd && byteCount <= regionEnd - pointer;
        if (readable) memcpy(output, reinterpret_cast<const void*>(pointer), byteCount);
        return readable;
    };
    uintptr_t stackWords[32]{};
    uintptr_t objectWords[8]{};
    uintptr_t vtableWords[8]{};
    const bool stackReadable = readWords(esp, stackWords, sizeof(stackWords));
    const bool objectReadable = readWords(ebx, objectWords, sizeof(objectWords));
    const uintptr_t objectVtable = objectReadable ? objectWords[0] : 0;
    const bool vtableReadable = readWords(objectVtable, vtableWords, sizeof(vtableWords));
    fprintf(stderr, "oracle_exception code=0x%08lx address=0x%Ix eip=0x%Ix ebp=0x%Ix ebx=0x%Ix edi=0x%Ix eax=0x%Ix ecx=0x%Ix edx=0x%Ix esi=0x%Ix esp=0x%Ix stackReadable=%s stack=[0x%Ix,0x%Ix,0x%Ix,0x%Ix,0x%Ix]\n",
        code, address, instruction, ebp, ebx, edi, eax, ecx, edx, esi, esp, stackReadable ? "true" : "false",
        stackWords[0], stackWords[1], stackWords[2], stackWords[3], stackWords[4]);
    fprintf(stderr, "oracle_exception_object readable=%s object=[0x%Ix,0x%Ix,0x%Ix,0x%Ix,0x%Ix,0x%Ix,0x%Ix,0x%Ix] vtable=0x%Ix vtableReadable=%s entries=[0x%Ix,0x%Ix,0x%Ix,0x%Ix,0x%Ix,0x%Ix,0x%Ix,0x%Ix]\n",
        objectReadable ? "true" : "false", objectWords[0], objectWords[1], objectWords[2], objectWords[3],
        objectWords[4], objectWords[5], objectWords[6], objectWords[7], objectVtable, vtableReadable ? "true" : "false",
        vtableWords[0], vtableWords[1], vtableWords[2], vtableWords[3],
        vtableWords[4], vtableWords[5], vtableWords[6], vtableWords[7]);
    fprintf(stderr, "oracle_exception_stack32");
    for (size_t index = 0; index < sizeof(stackWords) / sizeof(stackWords[0]); ++index) {
        fprintf(stderr, " [%zu]=0x%Ix", index, stackWords[index]);
    }
    fputc('\n', stderr);
    fflush(stderr);
    return EXCEPTION_EXECUTE_HANDLER;
}

bool copyPath(wchar_t* destination, const wchar_t* source) {
    const size_t length = wcslen(source);
    if (length >= MAX_PATH) return false;
    wcsncpy(destination, source, MAX_PATH);
    destination[length] = L'\0';
    return true;
}

void fail(const char* message) {
    fprintf(stderr, "oracle_error %s\n", message);
    ExitProcess(2);
}

bool hexDigest(const BYTE* bytes, ULONG length, char* output, size_t outputLength) {
    if (outputLength < 65) return false;
    for (ULONG i = 0; i < length; ++i) sprintf_s(output + i * 2, 3, "%02x", bytes[i]);
    output[64] = '\0';
    return true;
}

bool sha256File(const wchar_t* path, char output[65], DWORD* fileSize) {
    HANDLE file = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) return false;
    LARGE_INTEGER size{};
    if (!GetFileSizeEx(file, &size) || size.QuadPart < 0 || size.QuadPart > 0xffffffffLL) {
        CloseHandle(file);
        return false;
    }
    *fileSize = static_cast<DWORD>(size.QuadPart);

    BCRYPT_ALG_HANDLE algorithm = nullptr;
    BCRYPT_HASH_HANDLE hash = nullptr;
    DWORD objectLength = 0;
    DWORD resultLength = 0;
    PUCHAR object = nullptr;
    BYTE digest[32]{};
    bool ok = BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) == 0
        && BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH, reinterpret_cast<PUCHAR>(&objectLength), sizeof(objectLength), &resultLength, 0) == 0;
    if (ok) object = static_cast<PUCHAR>(malloc(objectLength));
    ok = ok && object != nullptr
        && BCryptCreateHash(algorithm, &hash, object, objectLength, nullptr, 0, 0) == 0;

    BYTE buffer[64 * 1024];
    while (ok) {
        DWORD read = 0;
        if (!ReadFile(file, buffer, sizeof(buffer), &read, nullptr)) { ok = false; break; }
        if (read == 0) break;
        if (BCryptHashData(hash, buffer, read, 0) != 0) { ok = false; break; }
    }
    if (ok) ok = BCryptFinishHash(hash, digest, sizeof(digest), 0) == 0 && hexDigest(digest, sizeof(digest), output, 65);
    if (hash) BCryptDestroyHash(hash);
    if (algorithm) BCryptCloseAlgorithmProvider(algorithm, 0);
    free(object);
    CloseHandle(file);
    return ok;
}

uintptr_t moduleRva(HMODULE module, uintptr_t pointer) {
    if (!module || !pointer) return 0;
    const auto base = reinterpret_cast<uintptr_t>(module);
    const auto dos = reinterpret_cast<const IMAGE_DOS_HEADER*>(base);
    if (dos->e_magic != IMAGE_DOS_SIGNATURE) return 0;
    const auto nt = reinterpret_cast<const IMAGE_NT_HEADERS32*>(base + dos->e_lfanew);
    if (nt->Signature != IMAGE_NT_SIGNATURE) return 0;
    const uintptr_t end = base + nt->OptionalHeader.SizeOfImage;
    return pointer >= base && pointer < end ? pointer - base : 0;
}

const char* moduleName(uintptr_t pointer, uintptr_t* rva) {
    const uintptr_t serverOffset = moduleRva(g_server, pointer);
    if (serverOffset) {
        *rva = serverOffset;
        return "Server.dll";
    }
    const uintptr_t clientOffset = moduleRva(g_client, pointer);
    if (clientOffset) {
        *rva = clientOffset;
        return "Client.dll";
    }
    *rva = 0;
    return "external";
}

void printModulePointer(uintptr_t pointer) {
    uintptr_t rva = 0;
    const char* module = moduleName(pointer, &rva);
    if (rva) printf("%s+0x%Ix", module, rva);
    else printf("0x%Ix", pointer);
}

bool g_quietHostStubs = false;
bool g_probeConfigObject = false;
bool g_invokeNativeDialog = false;
bool g_invokeNativeScr = false;
bool g_invokeNativeScrCore = false;
bool g_invokeNativeScrCoreReal = false;
bool g_invokeNativeScrTrigger = false;
bool g_invokeNativeScrEffect = false;
bool g_invokeNativeLevel = false;
unsigned g_nativeScrCommandCount = 0;
unsigned g_nativeScrHostCallCount = 0;

void logHostCall(unsigned slot) {
    if (g_quietHostStubs) return;
#if defined(_MSC_VER)
    uintptr_t* returnAddress = reinterpret_cast<uintptr_t*>(_AddressOfReturnAddress());
    const uintptr_t returnPointer = reinterpret_cast<uintptr_t>(_ReturnAddress());
#else
    uintptr_t* returnAddress = reinterpret_cast<uintptr_t*>(__builtin_frame_address(0)) + 1;
    const uintptr_t returnPointer = reinterpret_cast<uintptr_t>(__builtin_return_address(0));
#endif
    uintptr_t returnRva = 0;
    const char* returnModule = moduleName(returnPointer, &returnRva);
    printf("{\"event\":\"host_call\",\"slotOffset\":%u,\"returnModule\":\"%s\",\"returnRva\":\"0x%Ix\",\"args\":[",
        slot * static_cast<unsigned>(sizeof(uintptr_t)), returnModule, returnRva);
    for (size_t index = 0; index < kRawArgumentWords; ++index) {
        if (index) putchar(',');
        printf("\"0x%Ix\"", returnAddress[index + 1]);
    }
    printf("]}\n");
    fflush(stdout);
}
uintptr_t g_hostResultObject[64]{};
uintptr_t g_hostRegistryVtable[64]{};
uintptr_t g_hostRegistryObject[0x1400]{};
extern uintptr_t g_hostShortObjectVtable[64];
extern uintptr_t g_clientShortObjectVtable[64];
extern uintptr_t g_hostObjectVtable[64];
uintptr_t g_hostConfigObject[64]{};
uintptr_t g_probeVtable[64]{};
uintptr_t g_probeObject[8]{};
uintptr_t g_probeD3DDeviceVtable[64]{};
uintptr_t g_probeD3DDeviceObject[8]{};
HDC g_probeSurfaceDc = nullptr;
HBITMAP g_probeSurfaceBitmap = nullptr;
HGDIOBJ g_probeSurfacePreviousBitmap = nullptr;
uintptr_t g_clientGlobalVtable[64]{};
uintptr_t g_clientGlobalObject[0x200]{};
static uintptr_t ORACLE_CDECL serverGlobalServiceMethod() {
    return reinterpret_cast<uintptr_t>(g_hostResultObject);
}
static uintptr_t ORACLE_THISCALL clientGlobalNoArg(void*) {
    fprintf(stderr, "oracle_client_global_noarg return=0x%Ix\n", reinterpret_cast<uintptr_t>(__builtin_return_address(0)));
    return 0;
}
static uintptr_t ORACLE_THISCALL clientGlobalOneArg(void*, uintptr_t) {
    fprintf(stderr, "oracle_client_global_onearg return=0x%Ix\n", reinterpret_cast<uintptr_t>(__builtin_return_address(0)));
    return 0;
}
static uintptr_t ORACLE_THISCALL clientGlobalTwoArgs(void*, uintptr_t, uintptr_t) {
    fprintf(stderr, "oracle_client_global_twoargs return=0x%Ix\n", reinterpret_cast<uintptr_t>(__builtin_return_address(0)));
    return 0;
}
uintptr_t* g_probeClientObjectGlobal = nullptr;
uintptr_t g_hostInternalObjectVtable[64]{};
uintptr_t g_hostInternalObject[64]{};
uintptr_t g_clientFileObjectVtable[64]{};
uintptr_t g_clientFileObject[64]{};

static uintptr_t ORACLE_THISCALL hostObjectSlot26Method(void*, uintptr_t) {
    logHostCall(26);
    return 0;
}
static uintptr_t ORACLE_THISCALL hostInternalMethod1(void*, uintptr_t selector) {
    logHostCall(12);
    static const char userInterfaceExit[] = "\xC2\xFB\xF5\xEE\xE4 \xE8\xE7 \xE8\xE3\xF0\xFB";
    static const char userInterfaceExitPrompt[] = "\xC2\xFB \xF5\xEE\xF2\xE8\xF2\xE5 \xE2\xFB\xE9\xF2\xE8?";
    if (selector == 0x8e) return reinterpret_cast<uintptr_t>(userInterfaceExit);
    if (selector == 0x8f) return reinterpret_cast<uintptr_t>(userInterfaceExitPrompt);
    return 0;
}

static uintptr_t ORACLE_THISCALL hostInternalMethodTwoArgs(void*, uintptr_t, uintptr_t) {
    logHostCall(11);
    return 0;
}
static uintptr_t ORACLE_THISCALL hostObjectMethodOneArg(void*, uintptr_t output) {
    logHostCall(19);
    if (output) *reinterpret_cast<uintptr_t*>(output) = static_cast<uintptr_t>(GetTickCount());
    return 0;
}
// Server wrapper 0x140057cc forwards its first argument as the allocation size.
static uintptr_t ORACLE_THISCALL hostObjectAllocateMethod(void*, uintptr_t requestedSizeOrTag, uintptr_t, uintptr_t) {
    logHostCall(1);
    constexpr size_t kFallbackAllocationSize = 0x10000;
    const size_t requested = requestedSizeOrTag;
    const size_t size = requested > 0 && requested <= 0x1000000
        ? requested : kFallbackAllocationSize;
    void* memory = calloc(1, size);
    if (g_captureAgeNodeAllocations && requestedSizeOrTag == 0x50) {
        g_ageNodeAllocations.push_back(reinterpret_cast<uintptr_t>(memory));
    }
    if (!g_quietHostStubs) fprintf(stderr, "oracle_allocate requested=0x%Ix result=0x%Ix return=0x%Ix\n", requestedSizeOrTag, reinterpret_cast<uintptr_t>(memory), reinterpret_cast<uintptr_t>(__builtin_return_address(0)));
    if (g_client != nullptr && g_resources.size() >= 0xF && requestedSizeOrTag > 0x70000 && g_probeObject[0] != 0) {
        const uintptr_t state = *reinterpret_cast<const uintptr_t*>(reinterpret_cast<uintptr_t>(g_client) + 0x10fd04);
        if (state != 0 && *reinterpret_cast<const uintptr_t*>(state + 0x4434) == 0) {
            *reinterpret_cast<uintptr_t*>(state + 0x4434) = reinterpret_cast<uintptr_t>(g_probeObject);
        }
        if (state != 0 && *reinterpret_cast<const uintptr_t*>(state + 0x4424) == 0) {
            *reinterpret_cast<uintptr_t*>(state + 0x4424) = reinterpret_cast<uintptr_t>(g_probeD3DDeviceObject);
        }
    }
    return reinterpret_cast<uintptr_t>(memory);
}
static uintptr_t ORACLE_THISCALL hostObjectFreeIgnoredMethod(void*, uintptr_t) {
    logHostCall(2);
    return 0;

}
static uintptr_t ORACLE_THISCALL hostObjectFreeSuccessMethod(void*, uintptr_t) {
    logHostCall(2);
    return 1;
}
static uintptr_t ORACLE_THISCALL hostObjectQueryMethod(void*, uintptr_t, uintptr_t) {
    logHostCall(5);
    return 0;
}
static uintptr_t ORACLE_THISCALL hostClientShortResourceMethod(void*, uintptr_t path, uintptr_t) {
    logHostCall(5);
    const uintptr_t resource = openAssetResource(path);
    g_activeResource = resource;
    fprintf(stderr, "oracle_resource_open path=%s id=0x%Ix\n", path ? reinterpret_cast<const char*>(path) : "<null>", resource);
    return resource;
}
static uintptr_t ORACLE_THISCALL hostResourceLengthMethod(void*, uintptr_t resource) {
    logHostCall(2);
    const uintptr_t selected = resource != 0 ? resource : g_activeResource;
    if (selected == 0 || selected >= g_resources.size()) return 0;
    return static_cast<uintptr_t>(g_resources[selected].bytes.size());
}
bool loadUserInterfaceSdb() {
    if (g_userInterfaceSdbAttempted) return g_userInterfaceSdbValid;
    g_userInterfaceSdbAttempted = true;
    std::vector<unsigned char> bytes;
    const std::string path = g_assetRoot + "\\sdb\\user_interface.sdb";
    if (!readResourceFile(path, &bytes) || bytes.size() < 4 || memcmp(bytes.data(), "SDB ", 4) != 0) {
        fprintf(stderr, "oracle_sdb_error path=%s reason=invalid_header\n", path.c_str());
        return false;
    }
    auto readI32 = [&](size_t offset) -> int32_t {
        const uint32_t value = static_cast<uint32_t>(bytes[offset])
            | (static_cast<uint32_t>(bytes[offset + 1]) << 8)
            | (static_cast<uint32_t>(bytes[offset + 2]) << 16)
            | (static_cast<uint32_t>(bytes[offset + 3]) << 24);
        return static_cast<int32_t>(value);
    };
    size_t offset = 4;
    size_t recordCount = 0;
    while (offset < bytes.size()) {
        if (bytes.size() - offset < 8) {
            fprintf(stderr, "oracle_sdb_error path=%s reason=truncated_record offset=0x%Ix\n", path.c_str(), offset);
            return false;
        }
        const int32_t id = readI32(offset);
        const int32_t length = readI32(offset + 4);
        offset += 8;
        if (id < 0 || length < 0 || static_cast<size_t>(length) > bytes.size() - offset) {
            fprintf(stderr, "oracle_sdb_error path=%s reason=invalid_record id=%ld length=%ld offset=0x%Ix\n",
                path.c_str(), static_cast<long>(id), static_cast<long>(length), offset);
            return false;
        }
        const size_t index = static_cast<size_t>(id);
        if (index >= g_userInterfaceSdb.size()) {
            g_userInterfaceSdb.resize(index + 1);
            g_userInterfaceSdbPresent.resize(index + 1);
        }
        g_userInterfaceSdb[index].assign(reinterpret_cast<const char*>(bytes.data() + offset), static_cast<size_t>(length));
        g_userInterfaceSdbPresent[index] = 1;
        offset += static_cast<size_t>(length);
        recordCount += 1;
    }
    g_userInterfaceSdbValid = true;
    fprintf(stderr, "oracle_sdb_loaded path=%s records=%zu\n", path.c_str(), recordCount);
    return true;
}

void logSdbLookup(uintptr_t key, const std::string* value) {
    fprintf(stderr, "oracle_sdb_lookup key=0x%Ix resolved=%s bytes=", key, value ? "true" : "false");
    if (value) {
        for (const unsigned char byte : *value) fprintf(stderr, "%02x", byte);
    }
    fputc('\n', stderr);
}

static uintptr_t ORACLE_THISCALL hostResourceLookupMethod(void*, uintptr_t key) {
    logHostCall(12);
    if (!loadUserInterfaceSdb() || key >= g_userInterfaceSdb.size() || !g_userInterfaceSdbPresent[key]) {
        logSdbLookup(key, nullptr);
        return 0;
    }
    const std::string& value = g_userInterfaceSdb[key];
    logSdbLookup(key, &value);
    return reinterpret_cast<uintptr_t>(value.c_str());
}
static uintptr_t ORACLE_CDECL hostShortReadProbe(uintptr_t output, uintptr_t size, uintptr_t resource) {
    logHostCall(32);
    const uintptr_t selected = resource != 0 ? resource : g_activeResource;
    if (!g_quietHostStubs) fprintf(stderr, "oracle_resource_read output=0x%Ix size=0x%Ix resource=0x%Ix offset=0x%Ix\n", output, size, selected,
        selected != 0 && selected < g_resources.size() ? g_resources[selected].offset : 0);
    if (!output || selected == 0 || selected >= g_resources.size() || size > 0x100000) return 0;
    OracleResource& source = g_resources[selected];
    if (source.offset >= source.bytes.size()) return 0;
    const size_t remaining = source.bytes.size() - source.offset;
    const size_t readSize = size < remaining ? size : remaining;
    memcpy(reinterpret_cast<void*>(output), source.bytes.data() + source.offset, readSize);
    source.offset += readSize;
    return readSize;
}
static uintptr_t ORACLE_CDECL hostShortReleaseProbe(uintptr_t) {
    logHostCall(24);
    if (g_activeResource != 0 && g_activeResource < g_resources.size()) {
        g_resources[g_activeResource].bytes.clear();
        g_resources[g_activeResource].offset = 0;
    }
    g_activeResource = 0;
    return 1;
}
static uintptr_t ORACLE_THISCALL hostShortReleaseProbeThiscall(void*, uintptr_t);
static uintptr_t ORACLE_THISCALL hostShortReadProbeThiscall(void*, uintptr_t output, uintptr_t size, uintptr_t resource) {
    if (!g_quietHostStubs) fprintf(stderr, "oracle_resource_thiscall output=0x%Ix size=0x%Ix resource=0x%Ix\n", output, size, resource);
    return hostShortReadProbe(output, size, resource);
}
static uintptr_t ORACLE_THISCALL hostShortReleaseProbeThiscall(void*, uintptr_t resource) {
    return hostShortReleaseProbe(resource);
}
static uintptr_t ORACLE_THISCALL hostShortCheckMethod(void*, uintptr_t, uintptr_t) {
    logHostCall(1);
    return 0;
}
// Client pushes type, default/source, key; thiscall receives key, default/source, type.
// The returned object field +0x04 must point at the default/source string.
static uintptr_t ORACLE_THISCALL hostObjectConfigMethod(void*, uintptr_t, uintptr_t defaultValue, uintptr_t) {
    logHostCall(5);
    g_hostConfigObject[0] = reinterpret_cast<uintptr_t>(g_hostObjectVtable);
    g_hostConfigObject[1] = defaultValue;
    return reinterpret_cast<uintptr_t>(g_hostConfigObject);
}
static uintptr_t ORACLE_THISCALL hostRegistryLookupPair(void*, uintptr_t, uintptr_t) {
    logHostCall(0);
    return reinterpret_cast<uintptr_t>(g_hostRegistryObject);
}
static uintptr_t ORACLE_THISCALL hostRegistryLookupValue(void*, uintptr_t) {
    logHostCall(4);
    return reinterpret_cast<uintptr_t>(g_hostRegistryObject);
}
static uintptr_t ORACLE_THISCALL hostRegistryResolveValue(void*, uintptr_t) {
    logHostCall(6);
    return reinterpret_cast<uintptr_t>(g_hostRegistryObject);
}
static uintptr_t WINAPI hostSurfaceReleaseDcMethod(void*, uintptr_t) {
    logHostCall(26);
    return 0;
}
static uintptr_t WINAPI hostD3DDeviceGetCapsMethod(void*, D3DDEVICEDESC7* output) {
    fprintf(stderr, "oracle_d3d7_get_caps\n");
    logHostCall(3);
    if (!output) return static_cast<uintptr_t>(E_POINTER);
    memset(output, 0, sizeof(*output));
    output->dwDevCaps = D3DDEVCAPS_HWRASTERIZATION | D3DDEVCAPS_HWTRANSFORMANDLIGHT;
    output->dwMaxTextureWidth = 2048;
    output->dwMaxTextureHeight = 2048;
    output->wMaxTextureBlendStages = 8;
    output->wMaxSimultaneousTextures = 8;
    output->deviceGUID = kD3DTnLHalDeviceGuid;
    return 0;
}
static uintptr_t WINAPI hostD3DDeviceGetRenderTargetMethod(void*, uintptr_t output) {
    fprintf(stderr, "oracle_d3d7_get_render_target surface=0x%Ix\n", reinterpret_cast<uintptr_t>(g_probeObject));
    logHostCall(9);
    if (!output) return static_cast<uintptr_t>(E_POINTER);
    *reinterpret_cast<uintptr_t*>(output) = reinterpret_cast<uintptr_t>(g_probeObject);
    return 0;
}
static uintptr_t WINAPI hostD3DDeviceSetViewportMethod(void*, uintptr_t) {
    fprintf(stderr, "oracle_d3d7_set_viewport\n");
    logHostCall(13);
    return 0;
}
static uintptr_t WINAPI hostSurfaceGetDescriptionMethod(void*, DDSURFACEDESC2* output) {
    logHostCall(22);
    fprintf(stderr, "oracle_ddraw7_get_surface_desc width=1024 height=768\n");
    if (!output) return static_cast<uintptr_t>(E_POINTER);
    memset(output, 0, sizeof(*output));
    output->dwSize = sizeof(*output);
    output->dwFlags = DDSD_WIDTH | DDSD_HEIGHT | DDSD_PIXELFORMAT;
    output->dwWidth = 1024;
    output->dwHeight = 768;
    output->ddpfPixelFormat.dwSize = sizeof(output->ddpfPixelFormat);
    output->ddpfPixelFormat.dwFlags = DDPF_RGB;
    output->ddpfPixelFormat.dwRGBBitCount = 32;
    return 0;
}
static uintptr_t WINAPI hostProbeObjectMethod(void*, uintptr_t, uintptr_t) {
    logHostCall(4);
    return 0;
}
static uintptr_t WINAPI hostSurfaceGetDcMethod(void*, uintptr_t output) {
    logHostCall(17);
    if (!output) return static_cast<uintptr_t>(E_POINTER);
    if (!g_probeSurfaceDc) {
        BITMAPINFO bitmapInfo{};
        bitmapInfo.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
        bitmapInfo.bmiHeader.biWidth = 1024;
        bitmapInfo.bmiHeader.biHeight = -768;
        bitmapInfo.bmiHeader.biPlanes = 1;
        bitmapInfo.bmiHeader.biBitCount = 32;
        bitmapInfo.bmiHeader.biCompression = BI_RGB;
        void* pixels = nullptr;
        g_probeSurfaceDc = CreateCompatibleDC(nullptr);
        g_probeSurfaceBitmap = CreateDIBSection(g_probeSurfaceDc, &bitmapInfo, DIB_RGB_COLORS, &pixels, nullptr, 0);
        if (!g_probeSurfaceDc || !g_probeSurfaceBitmap) return static_cast<uintptr_t>(E_FAIL);
        g_probeSurfacePreviousBitmap = SelectObject(g_probeSurfaceDc, g_probeSurfaceBitmap);
    }
    *reinterpret_cast<HDC*>(output) = g_probeSurfaceDc;
    return 0;
}
static uintptr_t WINAPI hostSurfaceRestoreMethod(void*) {
    logHostCall(27);
    return 0;
}
void installClientGraphicsProbe(HMODULE module) {
    g_probeClientObjectGlobal = reinterpret_cast<uintptr_t*>(reinterpret_cast<uintptr_t>(module) + 0x110f48);
    g_probeVtable[4] = reinterpret_cast<uintptr_t>(&hostProbeObjectMethod);
    g_probeVtable[17] = reinterpret_cast<uintptr_t>(&hostSurfaceGetDcMethod);
    g_probeVtable[22] = reinterpret_cast<uintptr_t>(&hostSurfaceGetDescriptionMethod);
    g_probeVtable[26] = reinterpret_cast<uintptr_t>(&hostSurfaceReleaseDcMethod);
    g_probeVtable[27] = reinterpret_cast<uintptr_t>(&hostSurfaceRestoreMethod);
    g_probeObject[0] = reinterpret_cast<uintptr_t>(g_probeVtable);
    g_probeD3DDeviceVtable[3] = reinterpret_cast<uintptr_t>(&hostD3DDeviceGetCapsMethod);
    g_probeD3DDeviceVtable[4] = reinterpret_cast<uintptr_t>(&hostProbeObjectMethod);
    g_probeD3DDeviceVtable[9] = reinterpret_cast<uintptr_t>(&hostD3DDeviceGetRenderTargetMethod);
    g_probeD3DDeviceVtable[13] = reinterpret_cast<uintptr_t>(&hostD3DDeviceSetViewportMethod);
    g_probeD3DDeviceObject[0] = reinterpret_cast<uintptr_t>(g_probeD3DDeviceVtable);
    const uintptr_t directObjectSite = reinterpret_cast<uintptr_t>(module) + 0x25294;
    DWORD directOldProtect = 0;
    if (!VirtualProtect(reinterpret_cast<void*>(directObjectSite), 6, PAGE_EXECUTE_READWRITE, &directOldProtect)) fail("direct_object_probe_protect_failed");
    const uintptr_t fakeObject = reinterpret_cast<uintptr_t>(g_probeObject);
    uint8_t directPatch[6] = { 0xb8,
        static_cast<uint8_t>(fakeObject), static_cast<uint8_t>(fakeObject >> 8),
        static_cast<uint8_t>(fakeObject >> 16), static_cast<uint8_t>(fakeObject >> 24), 0x90 };
    memcpy(reinterpret_cast<void*>(directObjectSite), directPatch, sizeof(directPatch));
    FlushInstructionCache(GetCurrentProcess(), reinterpret_cast<void*>(directObjectSite), sizeof(directPatch));
    VirtualProtect(reinterpret_cast<void*>(directObjectSite), 6, directOldProtect, &directOldProtect);
}
static uintptr_t ORACLE_THISCALL hostObjectResourceMethod(void*, uintptr_t, uintptr_t defaultValue, uintptr_t) {
    logHostCall(4);
    g_hostResultObject[0] = reinterpret_cast<uintptr_t>(g_hostObjectVtable);
    g_hostResultObject[1] = defaultValue;
    return reinterpret_cast<uintptr_t>(g_hostResultObject);
}







#define DEFINE_OBJECT_METHOD3(index) \
    static uintptr_t ORACLE_THISCALL hostObjectMethod3_##index(void*, uintptr_t, uintptr_t, uintptr_t) { \
        logHostCall(index); \
        return 0; \
    }
DEFINE_OBJECT_METHOD3(0) DEFINE_OBJECT_METHOD3(1) DEFINE_OBJECT_METHOD3(2) DEFINE_OBJECT_METHOD3(3)
DEFINE_OBJECT_METHOD3(4) DEFINE_OBJECT_METHOD3(5) DEFINE_OBJECT_METHOD3(6) DEFINE_OBJECT_METHOD3(7)
DEFINE_OBJECT_METHOD3(8) DEFINE_OBJECT_METHOD3(9) DEFINE_OBJECT_METHOD3(10) DEFINE_OBJECT_METHOD3(11)
DEFINE_OBJECT_METHOD3(12) DEFINE_OBJECT_METHOD3(13) DEFINE_OBJECT_METHOD3(14) DEFINE_OBJECT_METHOD3(15)
DEFINE_OBJECT_METHOD3(16) DEFINE_OBJECT_METHOD3(17) DEFINE_OBJECT_METHOD3(18) DEFINE_OBJECT_METHOD3(19)
DEFINE_OBJECT_METHOD3(20) DEFINE_OBJECT_METHOD3(21) DEFINE_OBJECT_METHOD3(22) DEFINE_OBJECT_METHOD3(23)
DEFINE_OBJECT_METHOD3(24) DEFINE_OBJECT_METHOD3(25) DEFINE_OBJECT_METHOD3(26) DEFINE_OBJECT_METHOD3(27)
DEFINE_OBJECT_METHOD3(28) DEFINE_OBJECT_METHOD3(29) DEFINE_OBJECT_METHOD3(30) DEFINE_OBJECT_METHOD3(31)
DEFINE_OBJECT_METHOD3(32) DEFINE_OBJECT_METHOD3(33) DEFINE_OBJECT_METHOD3(34) DEFINE_OBJECT_METHOD3(35)
DEFINE_OBJECT_METHOD3(36) DEFINE_OBJECT_METHOD3(37) DEFINE_OBJECT_METHOD3(38) DEFINE_OBJECT_METHOD3(39)
DEFINE_OBJECT_METHOD3(40) DEFINE_OBJECT_METHOD3(41) DEFINE_OBJECT_METHOD3(42) DEFINE_OBJECT_METHOD3(43)
DEFINE_OBJECT_METHOD3(44) DEFINE_OBJECT_METHOD3(45) DEFINE_OBJECT_METHOD3(46) DEFINE_OBJECT_METHOD3(47)
DEFINE_OBJECT_METHOD3(48) DEFINE_OBJECT_METHOD3(49) DEFINE_OBJECT_METHOD3(50) DEFINE_OBJECT_METHOD3(51)
DEFINE_OBJECT_METHOD3(52) DEFINE_OBJECT_METHOD3(53) DEFINE_OBJECT_METHOD3(54) DEFINE_OBJECT_METHOD3(55)
DEFINE_OBJECT_METHOD3(56) DEFINE_OBJECT_METHOD3(57) DEFINE_OBJECT_METHOD3(58) DEFINE_OBJECT_METHOD3(59)
DEFINE_OBJECT_METHOD3(60) DEFINE_OBJECT_METHOD3(61) DEFINE_OBJECT_METHOD3(62) DEFINE_OBJECT_METHOD3(63)
static const uintptr_t kObjectMethod3[] = {
    reinterpret_cast<uintptr_t>(&hostObjectMethod3_0), reinterpret_cast<uintptr_t>(&hostObjectMethod3_1),
    reinterpret_cast<uintptr_t>(&hostObjectMethod3_2), reinterpret_cast<uintptr_t>(&hostObjectMethod3_3),
    reinterpret_cast<uintptr_t>(&hostObjectMethod3_4), reinterpret_cast<uintptr_t>(&hostObjectMethod3_5),
    reinterpret_cast<uintptr_t>(&hostObjectMethod3_6), reinterpret_cast<uintptr_t>(&hostObjectMethod3_7),
    reinterpret_cast<uintptr_t>(&hostObjectMethod3_8), reinterpret_cast<uintptr_t>(&hostObjectMethod3_9),
    reinterpret_cast<uintptr_t>(&hostObjectMethod3_10), reinterpret_cast<uintptr_t>(&hostObjectMethod3_11),
    reinterpret_cast<uintptr_t>(&hostObjectMethod3_12), reinterpret_cast<uintptr_t>(&hostObjectMethod3_13),
    reinterpret_cast<uintptr_t>(&hostObjectMethod3_14), reinterpret_cast<uintptr_t>(&hostObjectMethod3_15),
    reinterpret_cast<uintptr_t>(&hostObjectMethod3_16), reinterpret_cast<uintptr_t>(&hostObjectMethod3_17),
    reinterpret_cast<uintptr_t>(&hostObjectMethod3_18), reinterpret_cast<uintptr_t>(&hostObjectMethod3_19),
    reinterpret_cast<uintptr_t>(&hostObjectMethod3_20), reinterpret_cast<uintptr_t>(&hostObjectMethod3_21),
    reinterpret_cast<uintptr_t>(&hostObjectMethod3_22), reinterpret_cast<uintptr_t>(&hostObjectMethod3_23),
    reinterpret_cast<uintptr_t>(&hostObjectMethod3_24), reinterpret_cast<uintptr_t>(&hostObjectMethod3_25),
    reinterpret_cast<uintptr_t>(&hostObjectMethod3_26), reinterpret_cast<uintptr_t>(&hostObjectMethod3_27),
    reinterpret_cast<uintptr_t>(&hostObjectMethod3_28), reinterpret_cast<uintptr_t>(&hostObjectMethod3_29),
    reinterpret_cast<uintptr_t>(&hostObjectMethod3_30), reinterpret_cast<uintptr_t>(&hostObjectMethod3_31),
    reinterpret_cast<uintptr_t>(&hostObjectMethod3_32), reinterpret_cast<uintptr_t>(&hostObjectMethod3_33),
    reinterpret_cast<uintptr_t>(&hostObjectMethod3_34), reinterpret_cast<uintptr_t>(&hostObjectMethod3_35),
    reinterpret_cast<uintptr_t>(&hostObjectMethod3_36), reinterpret_cast<uintptr_t>(&hostObjectMethod3_37),
    reinterpret_cast<uintptr_t>(&hostObjectMethod3_38), reinterpret_cast<uintptr_t>(&hostObjectMethod3_39),
    reinterpret_cast<uintptr_t>(&hostObjectMethod3_40), reinterpret_cast<uintptr_t>(&hostObjectMethod3_41),
    reinterpret_cast<uintptr_t>(&hostObjectMethod3_42), reinterpret_cast<uintptr_t>(&hostObjectMethod3_43),
    reinterpret_cast<uintptr_t>(&hostObjectMethod3_44), reinterpret_cast<uintptr_t>(&hostObjectMethod3_45),
    reinterpret_cast<uintptr_t>(&hostObjectMethod3_46), reinterpret_cast<uintptr_t>(&hostObjectMethod3_47),
    reinterpret_cast<uintptr_t>(&hostObjectMethod3_48), reinterpret_cast<uintptr_t>(&hostObjectMethod3_49),
    reinterpret_cast<uintptr_t>(&hostObjectMethod3_50), reinterpret_cast<uintptr_t>(&hostObjectMethod3_51),
    reinterpret_cast<uintptr_t>(&hostObjectMethod3_52), reinterpret_cast<uintptr_t>(&hostObjectMethod3_53),
    reinterpret_cast<uintptr_t>(&hostObjectMethod3_54), reinterpret_cast<uintptr_t>(&hostObjectMethod3_55),
    reinterpret_cast<uintptr_t>(&hostObjectMethod3_56), reinterpret_cast<uintptr_t>(&hostObjectMethod3_57),
    reinterpret_cast<uintptr_t>(&hostObjectMethod3_58), reinterpret_cast<uintptr_t>(&hostObjectMethod3_59),
    reinterpret_cast<uintptr_t>(&hostObjectMethod3_60), reinterpret_cast<uintptr_t>(&hostObjectMethod3_61),
    reinterpret_cast<uintptr_t>(&hostObjectMethod3_62), reinterpret_cast<uintptr_t>(&hostObjectMethod3_63),
};

uintptr_t g_hostObjectVtable[64]{};
uintptr_t g_hostShortObjectVtable[64]{};
uintptr_t g_hostShortObject[64]{};
uintptr_t g_clientShortObjectVtable[64]{};
uintptr_t g_clientShortObject[64]{};
uintptr_t g_clientResourceObjectVtable[64]{};
uintptr_t g_clientResourceObject[64]{};
uintptr_t g_serverLevelServiceVtable[64]{};
uintptr_t g_serverLevelService[1]{};
uintptr_t g_serverWorldServiceVtable[64]{};
uintptr_t g_serverWorldService[1]{};
uintptr_t g_serverLookupServiceVtable[64]{};
uintptr_t g_serverLookupService[1]{};
uintptr_t g_serverPersonLookupServiceVtable[64]{};
uintptr_t g_serverPersonLookupService[1]{};
uintptr_t g_serverEntityServiceVtable[64]{};
uintptr_t g_serverEntityService[1]{};
uintptr_t g_serverDescriptorServiceVtable[64]{};
uintptr_t g_serverDescriptorService[1]{};
uintptr_t g_serverItemServiceVtable[64]{};
uintptr_t g_serverItemService[1]{};

static uintptr_t ORACLE_THISCALL serverLevelModeMethod(void*) {
    return 0;
}
static uintptr_t ORACLE_THISCALL serverLevelDimensionsMethod(void*, uintptr_t output) {
    if (!output) return 0;
    auto values = reinterpret_cast<uint32_t*>(output);
    values[0] = 230;
    values[1] = 224;
    printf("{\"event\":\"native_level_dimensions\",\"width\":230,\"height\":224}\n");
    return 0;
}
static uintptr_t ORACLE_THISCALL serverLevelSelectMethod(void*, uintptr_t levelName) {
    printf("{\"event\":\"native_level_select\",\"level\":\"%s\"}\n",
        levelName ? reinterpret_cast<const char*>(levelName) : "");
    return 0;
}
static uintptr_t ORACLE_THISCALL serverLevelFindTriggerMethod(void*, uintptr_t) {
    return 0;
}
static uintptr_t ORACLE_THISCALL serverLevelResolveTriggerMethod(void*, uintptr_t) {
    static uint8_t descriptor[0x200]{};
    return reinterpret_cast<uintptr_t>(descriptor);
}
static uintptr_t ORACLE_THISCALL serverLevelTriggerBaseMethod(void*) {
    static uint8_t triggerBase[0x1000]{};
    return reinterpret_cast<uintptr_t>(triggerBase);
}
static uintptr_t ORACLE_THISCALL serverLevelRootMethod(void*) {
    static const char levelRoot[] = "levels\\single\\L1_1";
    return reinterpret_cast<uintptr_t>(levelRoot);
}
static uintptr_t ORACLE_THISCALL serverLevelCellRowsMethod(void*) {
    static uintptr_t rows[4096]{};
    static uint8_t cells[4096 * 8]{};
    if (rows[0] == 0) {
        for (uintptr_t& row : rows) row = reinterpret_cast<uintptr_t>(cells);
    }
    return reinterpret_cast<uintptr_t>(rows);
}
static uintptr_t ORACLE_THISCALL serverWorldLookupMethod(void*, uintptr_t first, uintptr_t second) {
    printf("{\"event\":\"native_world_service\",\"method\":\"lookup\","
        "\"first\":\"0x%Ix\",\"second\":\"0x%Ix\"}\n", first, second);
    return UINTPTR_MAX;
}
static uintptr_t ORACLE_THISCALL serverWorldRefreshMethod(void*) {
    printf("{\"event\":\"native_world_service\",\"method\":\"refresh\"}\n");
    return 0;
}
static uintptr_t ORACLE_THISCALL serverWorldDestroyMethod(void*, uintptr_t value) {
    printf("{\"event\":\"native_world_service\",\"method\":\"destroy\","
        "\"value\":\"0x%Ix\"}\n", value);
    return 0;
}
static uintptr_t ORACLE_THISCALL serverLookupMissMethod(void*, uintptr_t, uintptr_t) {
    return 0;
}
static uintptr_t ORACLE_THISCALL serverLookupFirstMethod(void*, uintptr_t, uintptr_t output) {
    if (output) *reinterpret_cast<uint32_t*>(output) = 0;
    return 1;
}
static uintptr_t ORACLE_THISCALL serverRegisterEntityMethod(void*, uintptr_t, uintptr_t) {
    auto entity = static_cast<uint8_t*>(calloc(1, 0x600));
    auto animationRecords = static_cast<uint32_t*>(calloc(32, sizeof(uint32_t)));
    auto occupiedCells = static_cast<int32_t*>(calloc(2, sizeof(int32_t)));
    if (!entity || !animationRecords || !occupiedCells) fail("native_level_entity_allocation_failed");
    *reinterpret_cast<uint32_t*>(entity + 0x18c) = 32;
    for (size_t index = 0; index < 32; ++index) {
        animationRecords[index] = 0x11;
        *reinterpret_cast<uintptr_t*>(entity + 0x190 + index * sizeof(uintptr_t)) =
            reinterpret_cast<uintptr_t>(&animationRecords[index]);
    }
    *reinterpret_cast<uint32_t*>(entity + 0x210) = 1;
    *reinterpret_cast<uintptr_t*>(entity + 0x214) = reinterpret_cast<uintptr_t>(occupiedCells);
    return reinterpret_cast<uintptr_t>(entity);
}
static uintptr_t ORACLE_THISCALL serverResolveDescriptorMethod(void*, uintptr_t) {
    static uint8_t descriptor[0x200]{};
    return reinterpret_cast<uintptr_t>(descriptor);
}
static uintptr_t ORACLE_THISCALL serverFindItemMethod(void*, uintptr_t, uintptr_t) {
    return 1;
}
static uintptr_t ORACLE_THISCALL serverResolveItemMethod(void*, uintptr_t) {
    static uint8_t item[0x80]{};
    *reinterpret_cast<uint32_t*>(item + 0x30) = 1000;
    return reinterpret_cast<uintptr_t>(item);
}


constexpr size_t kHostObjectVtableSlots = sizeof(g_hostObjectVtable) / sizeof(g_hostObjectVtable[0]);
static_assert(sizeof(kObjectMethod3) / sizeof(kObjectMethod3[0]) == kHostObjectVtableSlots,
    "object vtable thunk count mismatch");
uintptr_t g_hostObject[kHostObjectVtableSlots]{};

void initializeHostObjectFacade() {
    for (size_t index = 0; index < kHostObjectVtableSlots; ++index) g_hostObjectVtable[index] = kObjectMethod3[index];
    g_hostObjectVtable[1] = reinterpret_cast<uintptr_t>(&hostObjectAllocateMethod);
    g_hostObjectVtable[2] = reinterpret_cast<uintptr_t>(&hostObjectFreeIgnoredMethod);
    g_hostObjectVtable[4] = reinterpret_cast<uintptr_t>(&hostObjectResourceMethod);
    for (size_t index = 0; index < kHostObjectVtableSlots; ++index) g_hostShortObjectVtable[index] = kObjectMethod3[index];
    g_hostShortObjectVtable[1] = reinterpret_cast<uintptr_t>(&hostObjectAllocateMethod);
    g_hostShortObjectVtable[2] = reinterpret_cast<uintptr_t>(&hostObjectFreeIgnoredMethod);
    g_hostShortObjectVtable[4] = reinterpret_cast<uintptr_t>(&hostObjectResourceMethod);
    g_hostShortObjectVtable[5] = reinterpret_cast<uintptr_t>(&hostObjectQueryMethod);
    if (g_probeConfigObject) g_hostShortObjectVtable[1] = reinterpret_cast<uintptr_t>(&hostShortCheckMethod);
    g_hostShortObject[0] = reinterpret_cast<uintptr_t>(g_hostShortObjectVtable);
    if (g_probeConfigObject) g_hostObjectVtable[2] = reinterpret_cast<uintptr_t>(&hostObjectFreeSuccessMethod);
    g_hostObject[0] = reinterpret_cast<uintptr_t>(g_hostObjectVtable);
    for (size_t index = 0; index < kHostObjectVtableSlots; ++index) {
        g_serverLevelServiceVtable[index] = g_hostObjectVtable[index];
        g_serverWorldServiceVtable[index] = g_hostObjectVtable[index];
        g_serverLookupServiceVtable[index] = g_hostObjectVtable[index];
        g_serverPersonLookupServiceVtable[index] = g_hostObjectVtable[index];
        g_serverEntityServiceVtable[index] = g_hostObjectVtable[index];
        g_serverDescriptorServiceVtable[index] = g_hostObjectVtable[index];
        g_serverItemServiceVtable[index] = g_hostObjectVtable[index];
    }
    g_serverLevelServiceVtable[0] = reinterpret_cast<uintptr_t>(&serverLevelModeMethod);
    g_serverLevelServiceVtable[0x0c / sizeof(uintptr_t)] =
        reinterpret_cast<uintptr_t>(&serverLevelFindTriggerMethod);
    g_serverLevelServiceVtable[0x1c / sizeof(uintptr_t)] =
        reinterpret_cast<uintptr_t>(&serverLevelResolveTriggerMethod);
    g_serverLevelServiceVtable[0x34 / sizeof(uintptr_t)] =
        reinterpret_cast<uintptr_t>(&serverLevelTriggerBaseMethod);
    g_serverLevelServiceVtable[0x58 / sizeof(uintptr_t)] =
        reinterpret_cast<uintptr_t>(&serverLevelRootMethod);
    g_serverLevelServiceVtable[0x5c / sizeof(uintptr_t)] =
        reinterpret_cast<uintptr_t>(&serverLevelCellRowsMethod);
    g_serverLevelServiceVtable[0x48 / sizeof(uintptr_t)] =
        reinterpret_cast<uintptr_t>(&serverLevelDimensionsMethod);
    g_serverLevelServiceVtable[0x7c / sizeof(uintptr_t)] =
        reinterpret_cast<uintptr_t>(&serverLevelSelectMethod);
    g_serverLevelService[0] = reinterpret_cast<uintptr_t>(g_serverLevelServiceVtable);
    g_serverWorldServiceVtable[0] = reinterpret_cast<uintptr_t>(&serverWorldLookupMethod);
    g_serverWorldServiceVtable[1] = reinterpret_cast<uintptr_t>(&serverWorldLookupMethod);
    g_serverWorldServiceVtable[2] = reinterpret_cast<uintptr_t>(&serverWorldRefreshMethod);
    g_serverWorldServiceVtable[3] = reinterpret_cast<uintptr_t>(&serverWorldDestroyMethod);
    g_serverWorldService[0] = reinterpret_cast<uintptr_t>(g_serverWorldServiceVtable);
    g_serverLookupServiceVtable[0x2c / sizeof(uintptr_t)] =
        reinterpret_cast<uintptr_t>(&serverLookupMissMethod);
    g_serverLookupService[0] = reinterpret_cast<uintptr_t>(g_serverLookupServiceVtable);
    g_serverPersonLookupServiceVtable[0x2c / sizeof(uintptr_t)] =
        reinterpret_cast<uintptr_t>(&serverLookupFirstMethod);
    g_serverPersonLookupService[0] = reinterpret_cast<uintptr_t>(g_serverPersonLookupServiceVtable);
    g_serverDescriptorServiceVtable[0x18 / sizeof(uintptr_t)] =
        reinterpret_cast<uintptr_t>(&serverResolveDescriptorMethod);
    g_serverDescriptorService[0] = reinterpret_cast<uintptr_t>(g_serverDescriptorServiceVtable);
    g_serverEntityServiceVtable[0x10 / sizeof(uintptr_t)] =
        reinterpret_cast<uintptr_t>(&serverRegisterEntityMethod);
    g_serverEntityService[0] = reinterpret_cast<uintptr_t>(g_serverEntityServiceVtable);
    g_serverItemServiceVtable[0] = reinterpret_cast<uintptr_t>(&serverFindItemMethod);
    g_serverItemServiceVtable[3] = reinterpret_cast<uintptr_t>(&serverResolveItemMethod);
    g_serverItemService[0] = reinterpret_cast<uintptr_t>(g_serverItemServiceVtable);
    g_hostResultObject[0] = reinterpret_cast<uintptr_t>(g_hostObjectVtable);
    g_hostResultObject[0x8c / sizeof(uintptr_t)] = g_invokeNativeLevel ? 0 : 1;
    for (size_t index = 0; index < kHostObjectVtableSlots; ++index) g_clientShortObjectVtable[index] = g_hostShortObjectVtable[index];
    g_clientShortObject[0] = reinterpret_cast<uintptr_t>(g_clientShortObjectVtable);
    if (g_probeConfigObject) g_clientShortObjectVtable[1] = reinterpret_cast<uintptr_t>(&hostShortCheckMethod);
    if (g_probeConfigObject) g_clientShortObjectVtable[2] = reinterpret_cast<uintptr_t>(&hostResourceLengthMethod);
    if (g_probeConfigObject) g_clientShortObjectVtable[5] = reinterpret_cast<uintptr_t>(&hostClientShortResourceMethod);
    if (g_probeConfigObject) g_clientShortObjectVtable[8] = reinterpret_cast<uintptr_t>(&hostShortReadProbeThiscall);
    if (g_probeConfigObject) g_clientShortObjectVtable[6] = reinterpret_cast<uintptr_t>(&hostShortReleaseProbeThiscall);
    for (size_t index = 0; index < kHostObjectVtableSlots; ++index) g_clientResourceObjectVtable[index] = g_hostShortObjectVtable[index];
    g_clientResourceObject[0] = reinterpret_cast<uintptr_t>(g_clientResourceObjectVtable);
    if (g_probeConfigObject) g_clientResourceObjectVtable[5] = reinterpret_cast<uintptr_t>(&hostClientShortResourceMethod);
    if (g_probeConfigObject) g_clientResourceObjectVtable[2] = reinterpret_cast<uintptr_t>(&hostResourceLengthMethod);
    if (g_probeConfigObject) g_clientResourceObjectVtable[8] = reinterpret_cast<uintptr_t>(&hostShortReadProbeThiscall);
    if (g_probeConfigObject) g_clientResourceObjectVtable[6] = reinterpret_cast<uintptr_t>(&hostShortReleaseProbeThiscall);
    if (g_probeConfigObject) g_clientResourceObjectVtable[12] = reinterpret_cast<uintptr_t>(&hostResourceLookupMethod);
    if (g_probeConfigObject) g_hostResultObject[0x88 / sizeof(uintptr_t)] = 0x3f800000;
    if (g_probeConfigObject) g_hostObjectVtable[3] = reinterpret_cast<uintptr_t>(&hostObjectResourceMethod);
    if (g_probeConfigObject) g_hostObjectVtable[5] = reinterpret_cast<uintptr_t>(&hostObjectConfigMethod);
    if (g_probeConfigObject) g_hostObjectVtable[26] = reinterpret_cast<uintptr_t>(&hostObjectSlot26Method);
    if (g_probeConfigObject) g_hostObjectVtable[19] = reinterpret_cast<uintptr_t>(&hostObjectMethodOneArg);
    if (g_probeConfigObject) {
        g_clientGlobalVtable[0] = reinterpret_cast<uintptr_t>(&clientGlobalOneArg);
        g_clientGlobalVtable[1] = reinterpret_cast<uintptr_t>(&clientGlobalOneArg);
        g_clientGlobalVtable[2] = reinterpret_cast<uintptr_t>(&clientGlobalTwoArgs);
        g_clientGlobalVtable[3] = reinterpret_cast<uintptr_t>(&clientGlobalOneArg);
        g_clientGlobalVtable[12] = reinterpret_cast<uintptr_t>(&clientGlobalOneArg);
        g_clientGlobalVtable[16] = reinterpret_cast<uintptr_t>(&clientGlobalNoArg);
        g_clientGlobalVtable[17] = reinterpret_cast<uintptr_t>(&clientGlobalNoArg);
        g_clientGlobalVtable[23] = reinterpret_cast<uintptr_t>(&clientGlobalNoArg);
        g_clientGlobalVtable[26] = reinterpret_cast<uintptr_t>(&clientGlobalOneArg);
        g_clientGlobalVtable[27] = reinterpret_cast<uintptr_t>(&clientGlobalNoArg);
        g_clientGlobalObject[0] = reinterpret_cast<uintptr_t>(g_clientGlobalVtable);
    }
    for (size_t index = 0; index < kHostObjectVtableSlots; ++index) g_hostRegistryVtable[index] = kObjectMethod3[index];
    g_hostRegistryVtable[0] = reinterpret_cast<uintptr_t>(&hostRegistryLookupPair);
    g_hostRegistryVtable[2] = reinterpret_cast<uintptr_t>(&hostRegistryLookupValue);
    g_hostRegistryVtable[4] = reinterpret_cast<uintptr_t>(&hostRegistryLookupValue);
    g_hostRegistryVtable[6] = reinterpret_cast<uintptr_t>(&hostRegistryResolveValue);
    g_hostRegistryObject[0] = reinterpret_cast<uintptr_t>(g_hostRegistryVtable);
    g_hostRegistryObject[0x118 / sizeof(uintptr_t)] = 1;
    g_hostRegistryObject[0x4cc0 / sizeof(uintptr_t)] = 0;
    for (size_t index = 0; index < kHostObjectVtableSlots; ++index) g_hostInternalObjectVtable[index] = kObjectMethod3[index];
    if (g_probeConfigObject) g_hostInternalObjectVtable[12] = reinterpret_cast<uintptr_t>(&hostInternalMethod1);
    for (size_t index = 0; index < kHostObjectVtableSlots; ++index) g_clientFileObjectVtable[index] = kObjectMethod3[index];
    if (g_probeConfigObject) g_clientFileObjectVtable[11] = reinterpret_cast<uintptr_t>(&hostInternalMethodTwoArgs);
    g_hostInternalObject[0] = reinterpret_cast<uintptr_t>(g_hostInternalObjectVtable);
    g_clientFileObject[0] = reinterpret_cast<uintptr_t>(g_clientFileObjectVtable);
}
#define DEFINE_HOST_STUB(index) \
    static uintptr_t __cdecl host_stub_##index(void) { logHostCall(index); return 0; }
DEFINE_HOST_STUB(0) DEFINE_HOST_STUB(1) DEFINE_HOST_STUB(2) DEFINE_HOST_STUB(3)
DEFINE_HOST_STUB(4) DEFINE_HOST_STUB(5) DEFINE_HOST_STUB(6) DEFINE_HOST_STUB(7)
DEFINE_HOST_STUB(8) DEFINE_HOST_STUB(9) DEFINE_HOST_STUB(10) DEFINE_HOST_STUB(11)
DEFINE_HOST_STUB(12) DEFINE_HOST_STUB(13) DEFINE_HOST_STUB(14) DEFINE_HOST_STUB(15)
DEFINE_HOST_STUB(16) DEFINE_HOST_STUB(17) DEFINE_HOST_STUB(18) DEFINE_HOST_STUB(19)
DEFINE_HOST_STUB(20) DEFINE_HOST_STUB(21) DEFINE_HOST_STUB(22) DEFINE_HOST_STUB(23)
DEFINE_HOST_STUB(24) DEFINE_HOST_STUB(25) DEFINE_HOST_STUB(26) DEFINE_HOST_STUB(27)
DEFINE_HOST_STUB(28) DEFINE_HOST_STUB(29) DEFINE_HOST_STUB(30) DEFINE_HOST_STUB(31)
DEFINE_HOST_STUB(32) DEFINE_HOST_STUB(33) DEFINE_HOST_STUB(34) DEFINE_HOST_STUB(35)
DEFINE_HOST_STUB(36) DEFINE_HOST_STUB(37) DEFINE_HOST_STUB(38) DEFINE_HOST_STUB(39)
DEFINE_HOST_STUB(40) DEFINE_HOST_STUB(41) DEFINE_HOST_STUB(42) DEFINE_HOST_STUB(43)
DEFINE_HOST_STUB(44) DEFINE_HOST_STUB(45) DEFINE_HOST_STUB(46) DEFINE_HOST_STUB(47)
DEFINE_HOST_STUB(48) DEFINE_HOST_STUB(49) DEFINE_HOST_STUB(50) DEFINE_HOST_STUB(51)
DEFINE_HOST_STUB(52) DEFINE_HOST_STUB(53) DEFINE_HOST_STUB(54) DEFINE_HOST_STUB(55)
DEFINE_HOST_STUB(56) DEFINE_HOST_STUB(57) DEFINE_HOST_STUB(58) DEFINE_HOST_STUB(59)
DEFINE_HOST_STUB(60) DEFINE_HOST_STUB(61) DEFINE_HOST_STUB(62) DEFINE_HOST_STUB(63)
DEFINE_HOST_STUB(64) DEFINE_HOST_STUB(65) DEFINE_HOST_STUB(66) DEFINE_HOST_STUB(67)
DEFINE_HOST_STUB(68) DEFINE_HOST_STUB(69) DEFINE_HOST_STUB(70) DEFINE_HOST_STUB(71)
DEFINE_HOST_STUB(72) DEFINE_HOST_STUB(73) DEFINE_HOST_STUB(74) DEFINE_HOST_STUB(75)
DEFINE_HOST_STUB(76) DEFINE_HOST_STUB(77) DEFINE_HOST_STUB(78) DEFINE_HOST_STUB(79)
DEFINE_HOST_STUB(80) DEFINE_HOST_STUB(81) DEFINE_HOST_STUB(82) DEFINE_HOST_STUB(83)
DEFINE_HOST_STUB(84) DEFINE_HOST_STUB(85) DEFINE_HOST_STUB(86) DEFINE_HOST_STUB(87)
DEFINE_HOST_STUB(88) DEFINE_HOST_STUB(89) DEFINE_HOST_STUB(90) DEFINE_HOST_STUB(91)
DEFINE_HOST_STUB(92) DEFINE_HOST_STUB(93) DEFINE_HOST_STUB(94) DEFINE_HOST_STUB(95)
DEFINE_HOST_STUB(96) DEFINE_HOST_STUB(97) DEFINE_HOST_STUB(98) DEFINE_HOST_STUB(99)
DEFINE_HOST_STUB(100) DEFINE_HOST_STUB(101) DEFINE_HOST_STUB(102) DEFINE_HOST_STUB(103)
DEFINE_HOST_STUB(104) DEFINE_HOST_STUB(105) DEFINE_HOST_STUB(106) DEFINE_HOST_STUB(107)
DEFINE_HOST_STUB(108) DEFINE_HOST_STUB(109) DEFINE_HOST_STUB(110) DEFINE_HOST_STUB(111)
DEFINE_HOST_STUB(112) DEFINE_HOST_STUB(113) DEFINE_HOST_STUB(114) DEFINE_HOST_STUB(115)
DEFINE_HOST_STUB(116) DEFINE_HOST_STUB(117) DEFINE_HOST_STUB(118) DEFINE_HOST_STUB(119)
DEFINE_HOST_STUB(120) DEFINE_HOST_STUB(121) DEFINE_HOST_STUB(122) DEFINE_HOST_STUB(123)
DEFINE_HOST_STUB(124) DEFINE_HOST_STUB(125) DEFINE_HOST_STUB(126) DEFINE_HOST_STUB(127)
DEFINE_HOST_STUB(128) DEFINE_HOST_STUB(129) DEFINE_HOST_STUB(130) DEFINE_HOST_STUB(131)
DEFINE_HOST_STUB(132) DEFINE_HOST_STUB(133) DEFINE_HOST_STUB(134) DEFINE_HOST_STUB(135)
DEFINE_HOST_STUB(136) DEFINE_HOST_STUB(137) DEFINE_HOST_STUB(138) DEFINE_HOST_STUB(139)
DEFINE_HOST_STUB(140) DEFINE_HOST_STUB(141) DEFINE_HOST_STUB(142) DEFINE_HOST_STUB(143)
DEFINE_HOST_STUB(144) DEFINE_HOST_STUB(145) DEFINE_HOST_STUB(146) DEFINE_HOST_STUB(147)
DEFINE_HOST_STUB(148) DEFINE_HOST_STUB(149) DEFINE_HOST_STUB(150) DEFINE_HOST_STUB(151)
DEFINE_HOST_STUB(152) DEFINE_HOST_STUB(153) DEFINE_HOST_STUB(154) DEFINE_HOST_STUB(155)
DEFINE_HOST_STUB(156) DEFINE_HOST_STUB(157) DEFINE_HOST_STUB(158) DEFINE_HOST_STUB(159)
DEFINE_HOST_STUB(160) DEFINE_HOST_STUB(161) DEFINE_HOST_STUB(162) DEFINE_HOST_STUB(163)
DEFINE_HOST_STUB(164) DEFINE_HOST_STUB(165) DEFINE_HOST_STUB(166) DEFINE_HOST_STUB(167)
DEFINE_HOST_STUB(168) DEFINE_HOST_STUB(169) DEFINE_HOST_STUB(170) DEFINE_HOST_STUB(171)
DEFINE_HOST_STUB(172) DEFINE_HOST_STUB(173) DEFINE_HOST_STUB(174) DEFINE_HOST_STUB(175)
DEFINE_HOST_STUB(176) DEFINE_HOST_STUB(177) DEFINE_HOST_STUB(178) DEFINE_HOST_STUB(179)
DEFINE_HOST_STUB(180) DEFINE_HOST_STUB(181) DEFINE_HOST_STUB(182) DEFINE_HOST_STUB(183)
DEFINE_HOST_STUB(184) DEFINE_HOST_STUB(185) DEFINE_HOST_STUB(186) DEFINE_HOST_STUB(187)
DEFINE_HOST_STUB(188) DEFINE_HOST_STUB(189) DEFINE_HOST_STUB(190) DEFINE_HOST_STUB(191)
DEFINE_HOST_STUB(192) DEFINE_HOST_STUB(193) DEFINE_HOST_STUB(194) DEFINE_HOST_STUB(195)
DEFINE_HOST_STUB(196) DEFINE_HOST_STUB(197) DEFINE_HOST_STUB(198) DEFINE_HOST_STUB(199)
DEFINE_HOST_STUB(200) DEFINE_HOST_STUB(201) DEFINE_HOST_STUB(202) DEFINE_HOST_STUB(203)
DEFINE_HOST_STUB(204) DEFINE_HOST_STUB(205) DEFINE_HOST_STUB(206) DEFINE_HOST_STUB(207)
DEFINE_HOST_STUB(208) DEFINE_HOST_STUB(209) DEFINE_HOST_STUB(210) DEFINE_HOST_STUB(211)
DEFINE_HOST_STUB(212) DEFINE_HOST_STUB(213) DEFINE_HOST_STUB(214) DEFINE_HOST_STUB(215)
DEFINE_HOST_STUB(216) DEFINE_HOST_STUB(217) DEFINE_HOST_STUB(218) DEFINE_HOST_STUB(219)
DEFINE_HOST_STUB(220) DEFINE_HOST_STUB(221) DEFINE_HOST_STUB(222) DEFINE_HOST_STUB(223)
DEFINE_HOST_STUB(224) DEFINE_HOST_STUB(225) DEFINE_HOST_STUB(226) DEFINE_HOST_STUB(227)
DEFINE_HOST_STUB(228) DEFINE_HOST_STUB(229) DEFINE_HOST_STUB(230) DEFINE_HOST_STUB(231)
DEFINE_HOST_STUB(232) DEFINE_HOST_STUB(233) DEFINE_HOST_STUB(234) DEFINE_HOST_STUB(235)
DEFINE_HOST_STUB(236) DEFINE_HOST_STUB(237) DEFINE_HOST_STUB(238) DEFINE_HOST_STUB(239)
DEFINE_HOST_STUB(240) DEFINE_HOST_STUB(241) DEFINE_HOST_STUB(242) DEFINE_HOST_STUB(243)
DEFINE_HOST_STUB(244) DEFINE_HOST_STUB(245) DEFINE_HOST_STUB(246) DEFINE_HOST_STUB(247)
DEFINE_HOST_STUB(248) DEFINE_HOST_STUB(249) DEFINE_HOST_STUB(250) DEFINE_HOST_STUB(251)
DEFINE_HOST_STUB(252) DEFINE_HOST_STUB(253) DEFINE_HOST_STUB(254) DEFINE_HOST_STUB(255)

using HostSlot = uintptr_t (__cdecl*)(void);
HostSlot kHostStubs[kHostSlots] = {
#define STUB_ENTRY(index) host_stub_##index,
    STUB_ENTRY(0) STUB_ENTRY(1) STUB_ENTRY(2) STUB_ENTRY(3) STUB_ENTRY(4) STUB_ENTRY(5) STUB_ENTRY(6) STUB_ENTRY(7)
    STUB_ENTRY(8) STUB_ENTRY(9) STUB_ENTRY(10) STUB_ENTRY(11) STUB_ENTRY(12) STUB_ENTRY(13) STUB_ENTRY(14) STUB_ENTRY(15)
    STUB_ENTRY(16) STUB_ENTRY(17) STUB_ENTRY(18) STUB_ENTRY(19) STUB_ENTRY(20) STUB_ENTRY(21) STUB_ENTRY(22) STUB_ENTRY(23)
    STUB_ENTRY(24) STUB_ENTRY(25) STUB_ENTRY(26) STUB_ENTRY(27) STUB_ENTRY(28) STUB_ENTRY(29) STUB_ENTRY(30) STUB_ENTRY(31)
    STUB_ENTRY(32) STUB_ENTRY(33) STUB_ENTRY(34) STUB_ENTRY(35) STUB_ENTRY(36) STUB_ENTRY(37) STUB_ENTRY(38) STUB_ENTRY(39)
    STUB_ENTRY(40) STUB_ENTRY(41) STUB_ENTRY(42) STUB_ENTRY(43) STUB_ENTRY(44) STUB_ENTRY(45) STUB_ENTRY(46) STUB_ENTRY(47)
    STUB_ENTRY(48) STUB_ENTRY(49) STUB_ENTRY(50) STUB_ENTRY(51) STUB_ENTRY(52) STUB_ENTRY(53) STUB_ENTRY(54) STUB_ENTRY(55)
    STUB_ENTRY(56) STUB_ENTRY(57) STUB_ENTRY(58) STUB_ENTRY(59) STUB_ENTRY(60) STUB_ENTRY(61) STUB_ENTRY(62) STUB_ENTRY(63)
    STUB_ENTRY(64) STUB_ENTRY(65) STUB_ENTRY(66) STUB_ENTRY(67) STUB_ENTRY(68) STUB_ENTRY(69) STUB_ENTRY(70) STUB_ENTRY(71)
    STUB_ENTRY(72) STUB_ENTRY(73) STUB_ENTRY(74) STUB_ENTRY(75) STUB_ENTRY(76) STUB_ENTRY(77) STUB_ENTRY(78) STUB_ENTRY(79)
    STUB_ENTRY(80) STUB_ENTRY(81) STUB_ENTRY(82) STUB_ENTRY(83) STUB_ENTRY(84) STUB_ENTRY(85) STUB_ENTRY(86) STUB_ENTRY(87)
    STUB_ENTRY(88) STUB_ENTRY(89) STUB_ENTRY(90) STUB_ENTRY(91) STUB_ENTRY(92) STUB_ENTRY(93) STUB_ENTRY(94) STUB_ENTRY(95)
    STUB_ENTRY(96) STUB_ENTRY(97) STUB_ENTRY(98) STUB_ENTRY(99) STUB_ENTRY(100) STUB_ENTRY(101) STUB_ENTRY(102) STUB_ENTRY(103)
    STUB_ENTRY(104) STUB_ENTRY(105) STUB_ENTRY(106) STUB_ENTRY(107) STUB_ENTRY(108) STUB_ENTRY(109) STUB_ENTRY(110) STUB_ENTRY(111)
    STUB_ENTRY(112) STUB_ENTRY(113) STUB_ENTRY(114) STUB_ENTRY(115) STUB_ENTRY(116) STUB_ENTRY(117) STUB_ENTRY(118) STUB_ENTRY(119)
    STUB_ENTRY(120) STUB_ENTRY(121) STUB_ENTRY(122) STUB_ENTRY(123) STUB_ENTRY(124) STUB_ENTRY(125) STUB_ENTRY(126) STUB_ENTRY(127)
    STUB_ENTRY(128) STUB_ENTRY(129) STUB_ENTRY(130) STUB_ENTRY(131)
    STUB_ENTRY(132) STUB_ENTRY(133) STUB_ENTRY(134) STUB_ENTRY(135)
    STUB_ENTRY(136) STUB_ENTRY(137) STUB_ENTRY(138) STUB_ENTRY(139)
    STUB_ENTRY(140) STUB_ENTRY(141) STUB_ENTRY(142) STUB_ENTRY(143)
    STUB_ENTRY(144) STUB_ENTRY(145) STUB_ENTRY(146) STUB_ENTRY(147)
    STUB_ENTRY(148) STUB_ENTRY(149) STUB_ENTRY(150) STUB_ENTRY(151)
    STUB_ENTRY(152) STUB_ENTRY(153) STUB_ENTRY(154) STUB_ENTRY(155)
    STUB_ENTRY(156) STUB_ENTRY(157) STUB_ENTRY(158) STUB_ENTRY(159)
    STUB_ENTRY(160) STUB_ENTRY(161) STUB_ENTRY(162) STUB_ENTRY(163)
    STUB_ENTRY(164) STUB_ENTRY(165) STUB_ENTRY(166) STUB_ENTRY(167)
    STUB_ENTRY(168) STUB_ENTRY(169) STUB_ENTRY(170) STUB_ENTRY(171)
    STUB_ENTRY(172) STUB_ENTRY(173) STUB_ENTRY(174) STUB_ENTRY(175)
    STUB_ENTRY(176) STUB_ENTRY(177) STUB_ENTRY(178) STUB_ENTRY(179)
    STUB_ENTRY(180) STUB_ENTRY(181) STUB_ENTRY(182) STUB_ENTRY(183)
    STUB_ENTRY(184) STUB_ENTRY(185) STUB_ENTRY(186) STUB_ENTRY(187)
    STUB_ENTRY(188) STUB_ENTRY(189) STUB_ENTRY(190) STUB_ENTRY(191)
    STUB_ENTRY(192) STUB_ENTRY(193) STUB_ENTRY(194) STUB_ENTRY(195)
    STUB_ENTRY(196) STUB_ENTRY(197) STUB_ENTRY(198) STUB_ENTRY(199)
    STUB_ENTRY(200) STUB_ENTRY(201) STUB_ENTRY(202) STUB_ENTRY(203)
    STUB_ENTRY(204) STUB_ENTRY(205) STUB_ENTRY(206) STUB_ENTRY(207)
    STUB_ENTRY(208) STUB_ENTRY(209) STUB_ENTRY(210) STUB_ENTRY(211)
    STUB_ENTRY(212) STUB_ENTRY(213) STUB_ENTRY(214) STUB_ENTRY(215)
    STUB_ENTRY(216) STUB_ENTRY(217) STUB_ENTRY(218) STUB_ENTRY(219)
    STUB_ENTRY(220) STUB_ENTRY(221) STUB_ENTRY(222) STUB_ENTRY(223)
    STUB_ENTRY(224) STUB_ENTRY(225) STUB_ENTRY(226) STUB_ENTRY(227)
    STUB_ENTRY(228) STUB_ENTRY(229) STUB_ENTRY(230) STUB_ENTRY(231)
    STUB_ENTRY(232) STUB_ENTRY(233) STUB_ENTRY(234) STUB_ENTRY(235)
    STUB_ENTRY(236) STUB_ENTRY(237) STUB_ENTRY(238) STUB_ENTRY(239)
    STUB_ENTRY(240) STUB_ENTRY(241) STUB_ENTRY(242) STUB_ENTRY(243)
    STUB_ENTRY(244) STUB_ENTRY(245) STUB_ENTRY(246) STUB_ENTRY(247)
    STUB_ENTRY(248) STUB_ENTRY(249) STUB_ENTRY(250) STUB_ENTRY(251)
    STUB_ENTRY(252) STUB_ENTRY(253) STUB_ENTRY(254) STUB_ENTRY(255)
#undef STUB_ENTRY
};
static_assert(sizeof(kHostStubs) / sizeof(kHostStubs[0]) == kHostSlots, "host slots mismatch");

void verifyModule(const ModuleSpec& spec) {
    char digest[65]{};
    DWORD size = 0;
    if (!sha256File(modulePath(spec), digest, &size)) fail("cannot_hash_module");
    if (size != spec.expectedSize || _stricmp(digest, spec.sha256) != 0) {
        fprintf(stderr, "oracle_error module_mismatch label=%ls size=%lu sha256=%s\n", spec.label, size, digest);
        ExitProcess(3);
    }
    printf("{\"event\":\"module_verified\",\"label\":\"%ls\",\"size\":%lu,\"sha256\":\"%s\"}\n", spec.label, size, digest);
}

void dumpApi(const wchar_t* label, const uintptr_t* table, HMODULE module) {
    (void)module;
    for (size_t index = 0; index < kModuleSlots; ++index) {
        if (!table[index]) continue;
        printf("{\"event\":\"api_slot\",\"module\":\"%ls\",\"offset\":%zu,\"value\":\"", label, index * sizeof(uintptr_t));
        printModulePointer(table[index]);
        printf("\"}\n");
    }
}
using NativeAllocate = void* (ORACLE_CDECL*)(size_t, size_t, uintptr_t, uintptr_t);
using NativeAgeContextConstructor = void* (ORACLE_THISCALL*)(void*);
using NativeAgeLoader = int (ORACLE_THISCALL*)(void*, const unsigned char*, uint32_t, void*, uintptr_t, uintptr_t);
using NativeContextEvaluate = void (ORACLE_THISCALL*)(void*, void*);
using NativeContextDestroy = void (ORACLE_THISCALL*)(void*);
using NativeFree = void (ORACLE_CDECL*)(void*);
using NativeAddVariable = int32_t (ORACLE_THISCALL*)(void*, const char*, int32_t, double);
using NativeSetNumericVariable = void (ORACLE_THISCALL*)(void*, const char*, double);
using NativeDialogueRebuild = void (ORACLE_THISCALL*)(void*);
using NativeDialogueClose = void (ORACLE_THISCALL*)(void*);
using NativeClientDialogueApply = void (ORACLE_THISCALL*)(void*, const void*);
using NativeClientDialoguePoll = uint32_t (ORACLE_THISCALL*)(void*);

int32_t nativeAgeRecordIndex(uintptr_t node) {
    if (!node) return -1;
    for (size_t index = 0; index < g_ageNodeAllocations.size(); ++index) {
        if (g_ageNodeAllocations[index] == node) return static_cast<int32_t>(index);
    }
    fail("native_age_node_pointer_not_mapped");
    return -1;
}

double ORACLE_THISCALL tracedNativeAgeEvaluate(void* program, void* nodePointer) {
    if (!g_nativeAgeEvaluate) fail("native_age_evaluator_not_installed");
    if (!g_nativeAgeTraceEnabled) return g_nativeAgeEvaluate(program, nodePointer);

    const unsigned depth = g_nativeAgeTraceDepth;
    g_nativeAgeTraceDepth += 1;
    const uintptr_t node = reinterpret_cast<uintptr_t>(nodePointer);
    const int32_t record = nativeAgeRecordIndex(node);
    const double result = g_nativeAgeEvaluate(program, nodePointer);
    g_nativeAgeTraceDepth -= 1;
    const unsigned sequence = ++g_nativeAgeEvaluationSequence;
    const uint32_t kind = *reinterpret_cast<const uint32_t*>(node + 0x3c);
    if (g_nativeTraceIsScr && kind == 48) {
        g_nativeSawScrCall = true;
        g_nativeLastScrCallResult = result;
        g_nativeScrCallResults.push_back(result);
    }
    if (g_nativeTraceIsScr) {
        printf("{\"event\":\"native_scr_evaluation\",\"turn\":%u,\"sequence\":%u,"
            "\"depth\":%u,\"record\":%ld,\"kind\":%lu,\"result\":%.17g}\n",
            g_nativeAgeTraceTurn, sequence, depth, static_cast<long>(record),
            static_cast<unsigned long>(kind), result);
    } else {
        printf("{\"event\":\"native_age_evaluation\",\"turn\":%u,\"sequence\":%u,"
            "\"depth\":%u,\"record\":%ld,\"result\":%.17g}\n",
            g_nativeAgeTraceTurn, sequence, depth, static_cast<long>(record), result);
    }

    if (depth == 0) {
        const bool requestedExit = *reinterpret_cast<const uint32_t*>(
            reinterpret_cast<uintptr_t>(g_server) + 0x88dd8) != 0;
        const bool zeroBranch = result == 0.0;
        const uintptr_t successor = *reinterpret_cast<const uintptr_t*>(
            node + (zeroBranch ? 0x08 : 0x0c));
        const int32_t successorRecord = nativeAgeRecordIndex(successor);
        const unsigned step = ++g_nativeAgeFlowStep;
        printf("{\"event\":\"%s\",\"turn\":%u,\"step\":%u,\"record\":%ld,"
            "\"result\":%.17g,\"branch\":\"%s\",\"successor\":%ld,\"exit\":%s}\n",
            g_nativeTraceIsScr ? "native_scr_node" : "native_age_node",
            g_nativeAgeTraceTurn, step, static_cast<long>(record), result,
            zeroBranch ? "zero" : "nonzero", static_cast<long>(successorRecord),
            requestedExit ? "true" : "false");
    }
    return result;
}
double ORACLE_THISCALL tracedNativeAgeArgumentEvaluate(void* program, void* nodePointer) {
    if (!g_nativeAgeArgumentEvaluate) fail("native_age_argument_evaluator_not_installed");
    if (!g_nativeAgeTraceEnabled) return g_nativeAgeArgumentEvaluate(program, nodePointer);

    const unsigned depth = g_nativeAgeTraceDepth;
    g_nativeAgeTraceDepth += 1;
    const uintptr_t node = reinterpret_cast<uintptr_t>(nodePointer);
    const int32_t record = nativeAgeRecordIndex(node);
    const double result = g_nativeAgeArgumentEvaluate(program, nodePointer);
    g_nativeAgeTraceDepth -= 1;
    const unsigned sequence = ++g_nativeAgeEvaluationSequence;
    const uint32_t kind = *reinterpret_cast<const uint32_t*>(node + 0x3c);
    if (g_nativeTraceIsScr && kind == 48) {
        g_nativeSawScrCall = true;
        g_nativeLastScrCallResult = result;
        g_nativeScrCallResults.push_back(result);
    }
    if (g_nativeTraceIsScr) {
        printf("{\"event\":\"native_scr_evaluation\",\"turn\":%u,\"sequence\":%u,"
            "\"depth\":%u,\"record\":%ld,\"kind\":%lu,\"result\":%.17g}\n",
            g_nativeAgeTraceTurn, sequence, depth, static_cast<long>(record),
            static_cast<unsigned long>(kind), result);
    } else {
        printf("{\"event\":\"native_age_evaluation\",\"turn\":%u,\"sequence\":%u,"
            "\"depth\":%u,\"record\":%ld,\"result\":%.17g}\n",
            g_nativeAgeTraceTurn, sequence, depth, static_cast<long>(record), result);
    }
    return result;
}


void installNativeAgeEvaluatorTrace(HMODULE module) {
    const uintptr_t base = reinterpret_cast<uintptr_t>(module);
    const auto dos = reinterpret_cast<const IMAGE_DOS_HEADER*>(base);
    const auto nt = reinterpret_cast<const IMAGE_NT_HEADERS32*>(base + dos->e_lfanew);
    const auto patchCalls = [&](uintptr_t target, uintptr_t replacement) {
        unsigned patched = 0;
        const IMAGE_SECTION_HEADER* section = IMAGE_FIRST_SECTION(nt);
        for (unsigned sectionIndex = 0; sectionIndex < nt->FileHeader.NumberOfSections; ++sectionIndex, ++section) {
            if ((section->Characteristics & IMAGE_SCN_MEM_EXECUTE) == 0) continue;
            const uintptr_t start = base + section->VirtualAddress;
            const size_t size = section->Misc.VirtualSize;
            for (size_t offset = 0; offset + 5 <= size; ++offset) {
                const uintptr_t callsite = start + offset;
                if (*reinterpret_cast<const uint8_t*>(callsite) != 0xe8) continue;
                int32_t displacement = 0;
                memcpy(&displacement, reinterpret_cast<const void*>(callsite + 1), sizeof(displacement));
                if (callsite + 5 + displacement != target) continue;
                const int64_t relative = static_cast<int64_t>(replacement) - static_cast<int64_t>(callsite + 5);
                if (relative < -0x80000000LL || relative > 0x7fffffffLL) {
                    fail("native_age_trace_call_out_of_range");
                }
                DWORD oldProtect = 0;
                if (!VirtualProtect(reinterpret_cast<void*>(callsite), 5, PAGE_EXECUTE_READWRITE, &oldProtect)) {
                    fail("native_age_trace_protect_failed");
                }
                const int32_t replacementDisplacement = static_cast<int32_t>(relative);
                memcpy(reinterpret_cast<void*>(callsite + 1), &replacementDisplacement, sizeof(replacementDisplacement));
                FlushInstructionCache(GetCurrentProcess(), reinterpret_cast<const void*>(callsite), 5);
                DWORD ignoredProtect = 0;
                VirtualProtect(reinterpret_cast<void*>(callsite), 5, oldProtect, &ignoredProtect);
                patched += 1;
                offset += 4;
            }
        }
        return patched;
    };

    g_nativeAgeEvaluate = reinterpret_cast<NativeAgeEvaluate>(base + 0x3a010);
    g_nativeAgeArgumentEvaluate = reinterpret_cast<NativeAgeEvaluate>(base + 0x3a914);
    const unsigned evaluatorCallsites = patchCalls(
        reinterpret_cast<uintptr_t>(g_nativeAgeEvaluate),
        reinterpret_cast<uintptr_t>(&tracedNativeAgeEvaluate));
    const unsigned argumentCallsites = patchCalls(
        reinterpret_cast<uintptr_t>(g_nativeAgeArgumentEvaluate),
        reinterpret_cast<uintptr_t>(&tracedNativeAgeArgumentEvaluate));
    printf("{\"event\":\"native_age_evaluator_hooks\",\"evaluatorCallsites\":%u,"
        "\"argumentCallsites\":%u}\n", evaluatorCallsites, argumentCallsites);
    if (evaluatorCallsites != 44 || argumentCallsites != 46) {
        fail("native_age_trace_callsite_count_mismatch");
    }
}

void beginNativeAgeTrace(unsigned turn) {
    g_nativeAgeTraceTurn = turn;
    g_nativeAgeTraceDepth = 0;
    g_nativeAgeEvaluationSequence = 0;
    g_nativeAgeFlowStep = 0;
    g_nativeAgeTraceEnabled = true;
}

void endNativeAgeTrace() {
    g_nativeAgeTraceEnabled = false;
    printf("{\"event\":\"%s\",\"turn\":%u,\"evaluations\":%u,\"flowNodes\":%u}\n",
        g_nativeTraceIsScr ? "native_scr_trace_summary" : "native_age_trace_summary",
        g_nativeAgeTraceTurn, g_nativeAgeEvaluationSequence, g_nativeAgeFlowStep);
}



void appendDialogueByte(std::vector<uint8_t>* bytes, uint32_t value) {
    bytes->push_back(static_cast<uint8_t>(value));
}

void appendDialogueUint16(std::vector<uint8_t>* bytes, uint32_t value) {
    appendDialogueByte(bytes, value);
    appendDialogueByte(bytes, value >> 8);
}

void appendDialogueUint32(std::vector<uint8_t>* bytes, uint32_t value) {
    appendDialogueByte(bytes, value);
    appendDialogueByte(bytes, value >> 8);
    appendDialogueByte(bytes, value >> 16);
    appendDialogueByte(bytes, value >> 24);
}

void emitDialoguePacketBytes(const char* direction, const char* turn, const std::vector<uint8_t>& bytes) {
    printf("{\"event\":\"native_dialogue_packet\",\"direction\":\"%s\",\"turn\":\"%s\","
        "\"opcode\":%u,\"byteLength\":%lu,\"bytes\":\"",
        direction, turn, bytes.empty() ? 0 : bytes[0], static_cast<unsigned long>(bytes.size()));
    for (uint8_t byte : bytes) printf("%02x", byte);
    printf("\"}\n");
}

std::vector<uint8_t> encodeNativeDialogueSnapshotPacket(uintptr_t dialog) {
    const uint32_t updateCounter = *reinterpret_cast<const uint32_t*>(dialog + 0x04);
    const uint32_t phraseId = *reinterpret_cast<const uint32_t*>(dialog + 0x08);
    const uint32_t replyCount = *reinterpret_cast<const uint32_t*>(dialog + 0x0c);
    const uint32_t context = *reinterpret_cast<const uint32_t*>(dialog + 0x10);
    const uint32_t owner = *reinterpret_cast<const uint32_t*>(dialog + 0x14);
    if (replyCount > 40) fail("native_dialogue_reply_count_out_of_range");
    const uint8_t substitutionLength = *reinterpret_cast<const uint8_t*>(dialog + 0xb8);
    const char* voice = reinterpret_cast<const char*>(dialog + 0x1bc);
    size_t voiceLength = 0;
    while (voiceLength < 0x104 && voice[voiceLength]) ++voiceLength;
    if (voiceLength > 0xff) fail("native_dialogue_voice_length_out_of_range");

    std::vector<uint8_t> bytes;
    bytes.reserve(15 + replyCount * 2 + substitutionLength + voiceLength);
    appendDialogueByte(&bytes, 12);
    appendDialogueUint32(&bytes, updateCounter);
    appendDialogueUint16(&bytes, phraseId);
    appendDialogueByte(&bytes, replyCount);
    for (uint32_t index = 0; index < replyCount; ++index) {
        appendDialogueUint16(&bytes, *reinterpret_cast<const uint32_t*>(dialog + 0x18 + index * 4));
    }
    appendDialogueUint32(&bytes, context);
    appendDialogueByte(&bytes, owner);
    appendDialogueByte(&bytes, substitutionLength);
    bytes.insert(bytes.end(),
        reinterpret_cast<const uint8_t*>(dialog + 0xb9),
        reinterpret_cast<const uint8_t*>(dialog + 0xb9 + substitutionLength));
    appendDialogueByte(&bytes, static_cast<uint32_t>(voiceLength));
    bytes.insert(bytes.end(),
        reinterpret_cast<const uint8_t*>(voice),
        reinterpret_cast<const uint8_t*>(voice + voiceLength));
    return bytes;
}

uint8_t readDialogueByte(const std::vector<uint8_t>& bytes, size_t* offset) {
    if (*offset >= bytes.size()) fail("native_dialogue_packet_truncated");
    return bytes[(*offset)++];
}

uint16_t readDialogueUint16(const std::vector<uint8_t>& bytes, size_t* offset) {
    const uint16_t low = readDialogueByte(bytes, offset);
    return static_cast<uint16_t>(low | static_cast<uint16_t>(readDialogueByte(bytes, offset) << 8));
}

uint32_t readDialogueUint32(const std::vector<uint8_t>& bytes, size_t* offset) {
    uint32_t value = readDialogueByte(bytes, offset);
    value |= static_cast<uint32_t>(readDialogueByte(bytes, offset)) << 8;
    value |= static_cast<uint32_t>(readDialogueByte(bytes, offset)) << 16;
    value |= static_cast<uint32_t>(readDialogueByte(bytes, offset)) << 24;
    return value;
}

std::vector<uint8_t> decodeNativeDialogueSnapshotPacket(const std::vector<uint8_t>& bytes) {
    size_t offset = 0;
    if (readDialogueByte(bytes, &offset) != 12) fail("native_dialogue_snapshot_opcode_mismatch");
    std::vector<uint8_t> payload(0x2bc);
    *reinterpret_cast<uint32_t*>(payload.data() + 0x00) = readDialogueUint32(bytes, &offset);
    *reinterpret_cast<uint32_t*>(payload.data() + 0x04) = readDialogueUint16(bytes, &offset);
    const uint32_t replyCount = readDialogueByte(bytes, &offset);
    if (replyCount > 40) fail("native_dialogue_reply_count_out_of_range");
    *reinterpret_cast<uint32_t*>(payload.data() + 0x08) = replyCount;
    for (uint32_t index = 0; index < replyCount; ++index) {
        *reinterpret_cast<uint32_t*>(payload.data() + 0x14 + index * 4) = readDialogueUint16(bytes, &offset);
    }
    *reinterpret_cast<uint32_t*>(payload.data() + 0x0c) = readDialogueUint32(bytes, &offset);
    *reinterpret_cast<uint32_t*>(payload.data() + 0x10) = readDialogueByte(bytes, &offset);
    const uint8_t substitutionLength = readDialogueByte(bytes, &offset);
    payload[0xb4] = substitutionLength;
    for (uint32_t index = 0; index < substitutionLength; ++index) {
        payload[0xb5 + index] = readDialogueByte(bytes, &offset);
    }
    const uint8_t voiceLength = readDialogueByte(bytes, &offset);
    for (uint32_t index = 0; index < voiceLength; ++index) {
        payload[0x1b8 + index] = readDialogueByte(bytes, &offset);
    }
    if (offset != bytes.size()) fail("native_dialogue_packet_trailing_bytes");
    return payload;
}

uint32_t applyNativeDialoguePacket(uintptr_t clientFacade, const std::vector<uint8_t>& bytes, uint32_t selectedReply) {
    if (!clientFacade || !g_client) return selectedReply;
    const std::vector<uint8_t> payload = decodeNativeDialogueSnapshotPacket(bytes);
    const uint32_t decodedPhrase = *reinterpret_cast<const uint32_t*>(payload.data() + 0x04);
    const uint32_t decodedReplyCount = *reinterpret_cast<const uint32_t*>(payload.data() + 0x08);
    std::vector<uint8_t> clientProbePayload = payload;
    *reinterpret_cast<uint32_t*>(clientProbePayload.data() + 0x04) = 0;
    *reinterpret_cast<uint32_t*>(clientProbePayload.data() + 0x08) = 0;
    const uintptr_t vtable = *reinterpret_cast<const uintptr_t*>(clientFacade);
    auto apply = reinterpret_cast<NativeClientDialogueApply>(
        *reinterpret_cast<const uintptr_t*>(vtable + 0xb4));
    auto poll = reinterpret_cast<NativeClientDialoguePoll>(
        *reinterpret_cast<const uintptr_t*>(vtable + 0xb8));
    // The minimal host has no live Client SDB ownership graph. Exercise the recovered apply
    // facade with the real update counter but an empty view; validate the complete decoded
    // phrase/reply payload in this harness before entering Client.dll.
    apply(reinterpret_cast<void*>(clientFacade), clientProbePayload.data());
    // Client.dll 0x120C706C forwards to 0x120A0F9C through the singleton at RVA 0x110ED4.
    // 0x120A2334 consumes +0x4B4 once; 0x120A0FA5/+0x4BC rejects unchanged snapshots.
    const uintptr_t clientDialogue = *reinterpret_cast<const uintptr_t*>(
        reinterpret_cast<uintptr_t>(g_client) + 0x110ed4);
    if (!clientDialogue) fail("native_client_dialogue_singleton_unavailable");
    printf("{\"event\":\"native_client_dialogue_layout\","
        "\"x\":%ld,\"y\":%ld,\"width\":%ld,\"height\":%ld,\"font\":\"%s\"}\n",
        static_cast<long>(*reinterpret_cast<const int32_t*>(clientDialogue + 0x149d0)),
        static_cast<long>(*reinterpret_cast<const int32_t*>(clientDialogue + 0x149d4)),
        static_cast<long>(*reinterpret_cast<const int32_t*>(clientDialogue + 0x149d8)),
        static_cast<long>(*reinterpret_cast<const int32_t*>(clientDialogue + 0x149cc)),
        reinterpret_cast<const char*>(clientDialogue + 0x3b0));
    const uint32_t appliedCounter = *reinterpret_cast<const uint32_t*>(clientDialogue + 0x4bc);
    if (appliedCounter != *reinterpret_cast<const uint32_t*>(payload.data())) {
        fail("native_client_dialogue_update_counter_mismatch");
    }
    *reinterpret_cast<uint32_t*>(clientDialogue + 0x4b4) = selectedReply;
    const uint32_t polledReply = poll(reinterpret_cast<void*>(clientFacade));
    const uint32_t repeatedPoll = poll(reinterpret_cast<void*>(clientFacade));
    printf("{\"event\":\"native_client_dialogue_bridge\",\"applyMode\":\"empty_snapshot_probe\","
        "\"updateCounter\":%lu,\"decodedPhrase\":%lu,\"decodedReplyCount\":%lu,"
        "\"selectedReply\":%lu,\"polledReply\":%lu,\"repeatedPoll\":%lu}\n",
        static_cast<unsigned long>(appliedCounter), static_cast<unsigned long>(decodedPhrase),
        static_cast<unsigned long>(decodedReplyCount), static_cast<unsigned long>(selectedReply),
        static_cast<unsigned long>(polledReply), static_cast<unsigned long>(repeatedPoll));
    if (polledReply != selectedReply || repeatedPoll != 0) fail("native_client_dialogue_poll_mismatch");
    return polledReply;
}

std::vector<uint8_t> encodeNativeDialogueReplyPacket(uint32_t replyId) {
    std::vector<uint8_t> bytes;
    bytes.reserve(5);
    appendDialogueByte(&bytes, 6);
    appendDialogueUint32(&bytes, replyId);
    return bytes;
}

void emitNativeDialogueSnapshot(const char* turn, int32_t submittedAnswer, uintptr_t dialog) {
    const uint32_t updateCounter = *reinterpret_cast<const uint32_t*>(dialog + 0x04);
    const int32_t phraseId = *reinterpret_cast<const int32_t*>(dialog + 0x08);
    const uint32_t replyCount = *reinterpret_cast<const uint32_t*>(dialog + 0x0c);
    const int32_t context = *reinterpret_cast<const int32_t*>(dialog + 0x10);
    const int32_t owner = *reinterpret_cast<const int32_t*>(dialog + 0x14);
    if (replyCount > 40) fail("native_dialogue_reply_count_out_of_range");
    printf("{\"event\":\"native_dialogue_snapshot\",\"turn\":\"%s\",\"submittedAnswer\":%ld,"
        "\"updateCounter\":%lu,\"phraseId\":%ld,\"replyCount\":%lu,\"context\":%ld,\"owner\":%ld,\"replies\":[",
        turn, static_cast<long>(submittedAnswer), static_cast<unsigned long>(updateCounter),
        static_cast<long>(phraseId), static_cast<unsigned long>(replyCount),
        static_cast<long>(context), static_cast<long>(owner));
    for (uint32_t index = 0; index < replyCount; ++index) {
        if (index) putchar(',');
        printf("%ld", static_cast<long>(*reinterpret_cast<const int32_t*>(dialog + 0x18 + index * sizeof(int32_t))));
    }
    printf("]}\n");
}

void printNativeScrJsonString(const char* value) {
    putchar('"');
    if (value) {
        for (const unsigned char* cursor = reinterpret_cast<const unsigned char*>(value); *cursor; ++cursor) {
            const unsigned char character = *cursor;
            if (character == '"' || character == '\\') {
                putchar('\\');
                putchar(character);
            } else if (character >= 0x20 && character < 0x7f) {
                putchar(character);
            } else {
                printf("\\u%04x", static_cast<unsigned>(character));
            }
        }
    }
    putchar('"');
}

const char* nativeScrStringArgument(unsigned index) {
    if (!g_server || index >= 16) fail("native_scr_argument_index_out_of_range");
    const uintptr_t base = reinterpret_cast<uintptr_t>(g_server);
    return *reinterpret_cast<const char* const*>(base + 0x89740 + index * 8);
}

void emitNativeScrHostCall(const char* name, unsigned argumentCount, double result) {
    g_nativeScrHostCallCount += 1;
    printf("{\"event\":\"native_scr_host_call\",\"name\":\"%s\",\"arguments\":[", name);
    for (unsigned index = 0; index < argumentCount; ++index) {
        if (index) putchar(',');
        printNativeScrJsonString(nativeScrStringArgument(index));
    }
    printf("],\"result\":%.17g}\n", result);
}

double ORACLE_CDECL nativeScrGetTribesRelationProbe() {
    constexpr double result = 1.0;
    emitNativeScrHostCall("rs_gettribesrelation", 2, result);
    return result;
}

double ORACLE_CDECL nativeScrSetTribesRelationProbe() {
    constexpr double result = 0.0;
    emitNativeScrHostCall("rs_settribesrelation", 3, result);
    return result;
}
double ORACLE_CDECL nativeScrCastEffectProbe() {
    constexpr double result = 0.0;
    const uintptr_t base = reinterpret_cast<uintptr_t>(g_server);
    g_nativeScrHostCallCount += 1;
    printf("{\"event\":\"native_scr_host_call\",\"name\":\"le_casteffect\",\"arguments\":[");
    printNativeScrJsonString(nativeScrStringArgument(0));
    putchar(',');
    printNativeScrJsonString(nativeScrStringArgument(1));
    printf(",%ld,%ld],\"result\":%.17g}\n",
        static_cast<long>(*reinterpret_cast<const int32_t*>(base + 0x89750)),
        static_cast<long>(*reinterpret_cast<const int32_t*>(base + 0x89758)),
        result);
    return result;
}


void patchNativeFunction(HMODULE module, uintptr_t rva, uintptr_t replacement) {
    const uintptr_t target = reinterpret_cast<uintptr_t>(module) + rva;
    const int32_t displacement = static_cast<int32_t>(replacement - (target + 5));
    uint8_t patch[5] = { 0xe9, 0, 0, 0, 0 };
    memcpy(patch + 1, &displacement, sizeof(displacement));
    DWORD oldProtect = 0;
    if (!VirtualProtect(reinterpret_cast<void*>(target), sizeof(patch), PAGE_EXECUTE_READWRITE, &oldProtect)) {
        fail("native_scr_host_patch_protect_failed");
    }
    memcpy(reinterpret_cast<void*>(target), patch, sizeof(patch));
    FlushInstructionCache(GetCurrentProcess(), reinterpret_cast<const void*>(target), sizeof(patch));
    DWORD ignoredProtect = 0;
    VirtualProtect(reinterpret_cast<void*>(target), sizeof(patch), oldProtect, &ignoredProtect);
}

void installNativeScrCoreHostProbes(HMODULE module) {
    patchNativeFunction(module, 0x400e4, reinterpret_cast<uintptr_t>(&nativeScrGetTribesRelationProbe));
    patchNativeFunction(module, 0x40078, reinterpret_cast<uintptr_t>(&nativeScrSetTribesRelationProbe));
    g_nativeScrHostCallCount = 0;
}

uintptr_t ORACLE_THISCALL nativeScrCommandProbe(void*, const char* command, uintptr_t immediate) {
    g_nativeScrCommandCount += 1;
    printf("{\"event\":\"native_scr_command\",\"command\":");
    printNativeScrJsonString(command);
    printf(",\"immediate\":%lu}\n", static_cast<unsigned long>(immediate));
    return 1;
}

void installNativeScrCommandProbe(HMODULE module) {
    const uintptr_t base = reinterpret_cast<uintptr_t>(module);
    const uintptr_t object = *reinterpret_cast<const uintptr_t*>(base + 0x88e2c);
    if (!object) fail("native_scr_command_object_unavailable");
    const uintptr_t vtable = *reinterpret_cast<const uintptr_t*>(object);
    uintptr_t* slot = reinterpret_cast<uintptr_t*>(vtable + 0x10);
    DWORD oldProtect = 0;
    if (!VirtualProtect(slot, sizeof(*slot), PAGE_READWRITE, &oldProtect)) {
        fail("native_scr_command_probe_protect_failed");
    }
    *slot = reinterpret_cast<uintptr_t>(&nativeScrCommandProbe);
    DWORD ignoredProtect = 0;
    VirtualProtect(slot, sizeof(*slot), oldProtect, &ignoredProtect);
    g_nativeScrCommandCount = 0;
}

std::string extractNativeScrHandlerBody(const std::string& source, const char* handler) {
    const size_t header = source.find(handler);
    if (header == std::string::npos) fail("native_scr_handler_missing");
    const size_t opening = source.find('{', header + strlen(handler));
    if (opening == std::string::npos) fail("native_scr_handler_opening_brace_missing");
    size_t depth = 1;
    char quote = 0;
    for (size_t cursor = opening + 1; cursor < source.size(); ++cursor) {
        const char character = source[cursor];
        if (quote) {
            if (character == '\\') cursor += 1;
            else if (character == quote) quote = 0;
        } else if (character == '"' || character == '\'') {
            quote = character;
        } else if (character == '{') {
            depth += 1;
        } else if (character == '}' && --depth == 0) {
            return source.substr(opening + 1, cursor - opening - 1);
        }
    }
    fail("native_scr_handler_closing_brace_missing");
    return {};
}

void invokeNativeScrFunction(HMODULE module, bool core, bool probeCoreHandlers) {
    std::vector<unsigned char> bytes;
    const std::string relativeAsset = core
        ? "levels/single/l1_1/scripts/core.scr"
        : "levels/single/l1_1/scripts/init.scr";
    const std::string asset = g_assetRoot + "\\" + relativeAsset;
    if (!readResourceFile(asset, &bytes) || bytes.empty() || bytes.size() > UINT32_MAX) {
        fail("cannot_read_native_scr_asset");
    }

    const uintptr_t base = reinterpret_cast<uintptr_t>(module);
    void* variableContext = *reinterpret_cast<void* const*>(base + 0x7f9a0);
    if (!variableContext) fail("native_scr_variable_context_unavailable");

    auto allocate = reinterpret_cast<NativeAllocate>(base + 0x057cc);
    auto freeMemory = reinterpret_cast<NativeFree>(base + 0x0579c);
    auto constructContext = reinterpret_cast<NativeAgeContextConstructor>(base + 0x38c54);
    auto loadContext = reinterpret_cast<NativeAgeLoader>(base + 0x38958);
    auto evaluateContext = reinterpret_cast<NativeContextEvaluate>(base + 0x38904);
    auto destroyContext = reinterpret_cast<NativeContextDestroy>(base + 0x38920);
    const uintptr_t variableVtable = *reinterpret_cast<const uintptr_t*>(variableContext);
    auto addVariable = reinterpret_cast<NativeAddVariable>(
        *reinterpret_cast<const uintptr_t*>(variableVtable + 0x18));
    const char* variables[] = { "L1_Svetlograd_n7_Helper", "result" };
    for (const char* name : variables) {
        if (addVariable(variableContext, name, 0, 0.0) != 0) fail("native_scr_variable_registration_failed");
    }

    void* context = allocate(0x0c, 1, 0, 0);
    if (!context) fail("native_scr_context_allocation_failed");
    constructContext(context);
    g_ageNodeAllocations.clear();
    g_captureAgeNodeAllocations = true;
    const int loaded = loadContext(
        context, bytes.data(), static_cast<uint32_t>(bytes.size()), variableContext, 0, 0);
    g_captureAgeNodeAllocations = false;
    if (!loaded) fail("native_scr_load_failed");
    if (g_ageNodeAllocations.empty()) fail("native_scr_node_allocations_missing");
    printf("{\"event\":\"native_scr_program\",\"asset\":\"%s\",\"bytes\":%lu,\"nodes\":%lu}\n",
        relativeAsset.c_str(), static_cast<unsigned long>(bytes.size()),
        static_cast<unsigned long>(g_ageNodeAllocations.size()));
    for (size_t index = 0; index < g_ageNodeAllocations.size(); ++index) {
        const uintptr_t node = g_ageNodeAllocations[index];
        printf("{\"event\":\"native_scr_node_layout\",\"record\":%lu,\"kind\":%lu}\n",
            static_cast<unsigned long>(index),
            static_cast<unsigned long>(*reinterpret_cast<const uint32_t*>(node + 0x3c)));
    }

    if (core) {
        const uintptr_t factions = *reinterpret_cast<const uintptr_t*>(base + 0x89fc0);
        const uint32_t factionCount = factions
            ? *reinterpret_cast<const uint32_t*>(factions + 0x20)
            : 0;
        printf("{\"event\":\"native_scr_world_state\",\"factions\":%lu}\n",
            static_cast<unsigned long>(factionCount));
    }
    if (probeCoreHandlers) installNativeScrCoreHostProbes(module);
    installNativeAgeEvaluatorTrace(module);
    g_nativeTraceIsScr = true;
    beginNativeAgeTrace(1);
    evaluateContext(context, variableContext);
    endNativeAgeTrace();
    g_nativeTraceIsScr = false;
    if (probeCoreHandlers && g_nativeScrHostCallCount != 16) fail("native_scr_host_call_count_mismatch");
    if (probeCoreHandlers) {
        printf("{\"event\":\"native_scr_host_summary\",\"calls\":%u}\n", g_nativeScrHostCallCount);
    }
    printf("{\"event\":\"native_scr_result\",\"asset\":\"%s\",\"executed\":true}\n",
        relativeAsset.c_str());

    destroyContext(context);
    const uint32_t loadedAfterDestroy = *reinterpret_cast<const uint32_t*>(context);
    printf("{\"event\":\"native_scr_closed\",\"loaded\":%lu}\n",
        static_cast<unsigned long>(loadedAfterDestroy));
    freeMemory(context);
}
void invokeNativeScrTrigger(HMODULE module) {
    std::vector<unsigned char> bytes;
    const std::string relativeAsset = "levels/single/l1_1/scripts/tg_exit_l1_2.scr";
    const std::string asset = g_assetRoot + "\\" + relativeAsset;
    if (!readResourceFile(asset, &bytes) || bytes.empty()) fail("cannot_read_native_scr_trigger_asset");
    const std::string source(reinterpret_cast<const char*>(bytes.data()), bytes.size());
    const std::string body = extractNativeScrHandlerBody(source, "OnHover");

    const uintptr_t base = reinterpret_cast<uintptr_t>(module);
    uintptr_t* worldSlot = reinterpret_cast<uintptr_t*>(base + 0x88dc4);
    const uintptr_t originalWorld = *worldSlot;
    void* syntheticWorld = nullptr;
    if (!originalWorld) {
        syntheticWorld = calloc(1, 0x6060);
        if (!syntheticWorld) fail("native_scr_trigger_world_allocation_failed");
        *worldSlot = reinterpret_cast<uintptr_t>(syntheticWorld);
    }
    const uintptr_t world = *worldSlot;

    installNativeScrCommandProbe(module);
    installNativeAgeEvaluatorTrace(module);
    g_ageNodeAllocations.clear();
    g_captureAgeNodeAllocations = true;
    g_nativeTraceIsScr = true;
    beginNativeAgeTrace(1);
    auto executeBody = reinterpret_cast<void (ORACLE_STDCALL*)(const char*)>(base + 0x232b0);
    executeBody(body.c_str());
    endNativeAgeTrace();
    g_nativeTraceIsScr = false;
    g_captureAgeNodeAllocations = false;

    printf("{\"event\":\"native_scr_program\",\"asset\":\"%s\",\"handler\":\"OnHover\","
        "\"bytes\":%lu,\"bodyBytes\":%lu,\"nodes\":%lu}\n",
        relativeAsset.c_str(), static_cast<unsigned long>(bytes.size()),
        static_cast<unsigned long>(body.size()),
        static_cast<unsigned long>(g_ageNodeAllocations.size()));
    const uint32_t entranceLength = *reinterpret_cast<const uint32_t*>(world + 0x5f54);
    printf("{\"event\":\"native_scr_trigger_state\",\"entrance\":");
    printNativeScrJsonString(reinterpret_cast<const char*>(world + 0x5f58));
    printf(",\"entranceLength\":%lu,\"commands\":%u}\n",
        static_cast<unsigned long>(entranceLength), g_nativeScrCommandCount);
    if (entranceLength != 11) fail("native_scr_trigger_entrance_length_mismatch");
    if (g_nativeScrCommandCount != 1) fail("native_scr_trigger_command_count_mismatch");
    printf("{\"event\":\"native_scr_closed\",\"loaded\":0}\n");

    if (syntheticWorld) {
        *worldSlot = originalWorld;
        free(syntheticWorld);
    }
}
void invokeNativeScrEffect(HMODULE module) {
    std::vector<unsigned char> bytes;
    const std::string relativeAsset = "levels/single/l10_2_1/scripts/init.scr";
    const std::string asset = g_assetRoot + "\\" + relativeAsset;
    if (!readResourceFile(asset, &bytes) || bytes.empty()) fail("cannot_read_native_scr_effect_asset");
    const std::string source(reinterpret_cast<const char*>(bytes.data()), bytes.size());

    patchNativeFunction(module, 0x3fe2c, reinterpret_cast<uintptr_t>(&nativeScrCastEffectProbe));
    g_nativeScrHostCallCount = 0;
    installNativeAgeEvaluatorTrace(module);
    g_ageNodeAllocations.clear();
    g_captureAgeNodeAllocations = true;
    g_nativeTraceIsScr = true;
    beginNativeAgeTrace(1);
    const uintptr_t base = reinterpret_cast<uintptr_t>(module);
    auto executeBody = reinterpret_cast<void (ORACLE_STDCALL*)(const char*)>(base + 0x232b0);
    executeBody(source.c_str());
    endNativeAgeTrace();
    g_nativeTraceIsScr = false;
    g_captureAgeNodeAllocations = false;

    printf("{\"event\":\"native_scr_program\",\"asset\":\"%s\",\"handler\":null,"
        "\"bytes\":%lu,\"bodyBytes\":%lu,\"nodes\":%lu}\n",
        relativeAsset.c_str(), static_cast<unsigned long>(bytes.size()),
        static_cast<unsigned long>(bytes.size()),
        static_cast<unsigned long>(g_ageNodeAllocations.size()));
    printf("{\"event\":\"native_scr_host_summary\",\"calls\":%u}\n", g_nativeScrHostCallCount);
    if (g_nativeScrHostCallCount != 4) fail("native_scr_effect_call_count_mismatch");
    printf("{\"event\":\"native_scr_closed\",\"loaded\":0}\n");
}
void invokeNativeLevel(uintptr_t serverFacade) {
    if (!serverFacade) fail("native_level_server_facade_unavailable");
    auto vtable = *reinterpret_cast<uintptr_t* const*>(serverFacade);
    if (!vtable || !vtable[0x28 / sizeof(uintptr_t)]) fail("native_level_loader_unavailable");
    printf("{\"event\":\"native_level_loader\",\"slotOffset\":40,\"value\":\"");
    printModulePointer(vtable[0x28 / sizeof(uintptr_t)]);
    printf("\"}\n");
    const char* levelName = "L1_1";
    printf("{\"event\":\"native_level_load\",\"level\":\"%s\",\"phase\":\"before\"}\n", levelName);
    auto loadLevel = reinterpret_cast<void (ORACLE_THISCALL*)(void*, const char*, int)>(
        vtable[0x28 / sizeof(uintptr_t)]);
    loadLevel(reinterpret_cast<void*>(serverFacade), levelName, 0);
    const uintptr_t world = *reinterpret_cast<const uintptr_t*>(
        reinterpret_cast<uintptr_t>(g_server) + 0x88dc4);
    printf("{\"event\":\"native_level_load\",\"level\":\"%s\",\"phase\":\"after\",\"world\":\"0x%Ix\"}\n",
        levelName, world);
    const char query[] =
        "oracle_person_exists_before = RS_IsPersonExistsI(\"L1_1\", \"L1_1.P387_Poison_Plotnik\");"
        "oracle_delete_result = RS_DelPerson(\"L1_1.P387_Poison_Plotnik\");"
        "oracle_person_exists_after = RS_IsPersonExistsI(\"L1_1\", \"L1_1.P387_Poison_Plotnik\");";
    const uintptr_t base = reinterpret_cast<uintptr_t>(g_server);
    void* variableContext = *reinterpret_cast<void* const*>(base + 0x7f9a0);
    if (!variableContext) fail("native_level_variable_context_unavailable");
    const uintptr_t variableVtable = *reinterpret_cast<const uintptr_t*>(variableContext);
    auto addVariable = reinterpret_cast<NativeAddVariable>(
        *reinterpret_cast<const uintptr_t*>(variableVtable + 0x18));
    const char* queryVariables[] = {
        "oracle_person_exists_before",
        "oracle_delete_result",
        "oracle_person_exists_after",
        "oracle_person_exists_reload",
    };
    for (const char* name : queryVariables) {
        if (addVariable(variableContext, name, 0, 0.0) != 0) {
            fail("native_level_query_variable_registration_failed");
        }
    }
    auto allocate = reinterpret_cast<NativeAllocate>(base + 0x057cc);
    auto freeMemory = reinterpret_cast<NativeFree>(base + 0x0579c);
    auto constructContext = reinterpret_cast<NativeAgeContextConstructor>(base + 0x38c54);
    auto loadContext = reinterpret_cast<NativeAgeLoader>(base + 0x38958);
    auto evaluateContext = reinterpret_cast<NativeContextEvaluate>(base + 0x38904);
    auto destroyContext = reinterpret_cast<NativeContextDestroy>(base + 0x38920);
    void* context = allocate(0x0c, 1, 0, 0);
    if (!context) fail("native_level_query_context_allocation_failed");
    constructContext(context);
    g_ageNodeAllocations.clear();
    g_captureAgeNodeAllocations = true;
    const int loaded = loadContext(context, reinterpret_cast<const unsigned char*>(query),
        static_cast<uint32_t>(strlen(query)), variableContext, 0, 0);
    g_captureAgeNodeAllocations = false;
    if (!loaded) fail("native_level_query_load_failed");
    for (size_t index = 0; index < g_ageNodeAllocations.size(); ++index) {
        const uintptr_t node = g_ageNodeAllocations[index];
        printf("{\"event\":\"native_level_scr_node\",\"phase\":\"transition\","
            "\"record\":%lu,\"kind\":%lu}\n",
            static_cast<unsigned long>(index),
            static_cast<unsigned long>(*reinterpret_cast<const uint32_t*>(node + 0x3c)));
    }
    installNativeAgeEvaluatorTrace(g_server);
    g_nativeTraceIsScr = true;
    g_nativeSawScrCall = false;
    g_nativeScrCallResults.clear();
    beginNativeAgeTrace(1);
    evaluateContext(context, variableContext);
    endNativeAgeTrace();
    g_nativeTraceIsScr = false;
    destroyContext(context);
    freeMemory(context);
    if (!g_nativeSawScrCall || g_nativeScrCallResults.size() != 3) {
        fail("native_level_person_transition_call_count_mismatch");
    }
    const double beforeDelete = g_nativeScrCallResults[0];
    const double deleteResult = g_nativeScrCallResults[1];
    const double afterDelete = g_nativeScrCallResults[2];
    printf("{\"event\":\"native_level_person_transition\",\"level\":\"L1_1\","
        "\"person\":\"L1_1.P387_Poison_Plotnik\",\"beforeDelete\":%.17g,"
        "\"deleteResult\":%.17g,\"afterDelete\":%.17g,\"nodes\":%lu}\n",
        beforeDelete, deleteResult, afterDelete,
        static_cast<unsigned long>(g_ageNodeAllocations.size()));
    if (beforeDelete != 1.0 || deleteResult != 0.0 || afterDelete != 0.0) {
        fail("native_level_person_transition_mismatch");
    }
    printf("{\"event\":\"native_level_reload\",\"level\":\"%s\",\"phase\":\"before\"}\n", levelName);
    loadLevel(reinterpret_cast<void*>(serverFacade), levelName, 0);
    const uintptr_t reloadedWorld = *reinterpret_cast<const uintptr_t*>(
        reinterpret_cast<uintptr_t>(g_server) + 0x88dc4);
    printf("{\"event\":\"native_level_reload\",\"level\":\"%s\","
        "\"phase\":\"after\",\"world\":\"0x%Ix\"}\n", levelName, reloadedWorld);
    const char reloadQuery[] =
        "oracle_person_exists_reload = "
        "RS_IsPersonExistsI(\"L1_1\", \"L1_1.P387_Poison_Plotnik\");";
    void* reloadContext = allocate(0x0c, 1, 0, 0);
    if (!reloadContext) fail("native_level_reload_context_allocation_failed");
    constructContext(reloadContext);
    g_ageNodeAllocations.clear();
    g_captureAgeNodeAllocations = true;
    const int reloadLoaded = loadContext(reloadContext,
        reinterpret_cast<const unsigned char*>(reloadQuery),
        static_cast<uint32_t>(strlen(reloadQuery)), variableContext, 0, 0);
    g_captureAgeNodeAllocations = false;
    if (!reloadLoaded) fail("native_level_reload_query_load_failed");
    for (size_t index = 0; index < g_ageNodeAllocations.size(); ++index) {
        const uintptr_t node = g_ageNodeAllocations[index];
        printf("{\"event\":\"native_level_scr_node\",\"phase\":\"reload\","
            "\"record\":%lu,\"kind\":%lu}\n",
            static_cast<unsigned long>(index),
            static_cast<unsigned long>(*reinterpret_cast<const uint32_t*>(node + 0x3c)));
    }
    g_nativeTraceIsScr = true;
    g_nativeSawScrCall = false;
    g_nativeScrCallResults.clear();
    beginNativeAgeTrace(2);
    evaluateContext(reloadContext, variableContext);
    endNativeAgeTrace();
    g_nativeTraceIsScr = false;
    destroyContext(reloadContext);
    freeMemory(reloadContext);
    if (!g_nativeSawScrCall || g_nativeScrCallResults.size() != 1
        || g_nativeScrCallResults[0] != 1.0) {
        fail("native_level_person_reload_mismatch");
    }
    printf("{\"event\":\"native_level_person_reload\",\"level\":\"L1_1\","
        "\"person\":\"L1_1.P387_Poison_Plotnik\",\"result\":%.17g,\"nodes\":%lu}\n",
        g_nativeScrCallResults[0], static_cast<unsigned long>(g_ageNodeAllocations.size()));
}




void invokeNativeDialogFunction(HMODULE module, uintptr_t clientFacade) {
    std::vector<unsigned char> bytes;
    const std::string asset = g_assetRoot + "\\scripts\\dialogs\\demon.d1.age.cs";
    if (!readResourceFile(asset, &bytes) || bytes.empty() || bytes.size() > UINT32_MAX) {
        fail("cannot_read_native_dialogue_asset");
    }

    const uintptr_t base = reinterpret_cast<uintptr_t>(module);
    const uintptr_t dialog = *reinterpret_cast<const uintptr_t*>(base + 0x88de8);
    void* variableContext = *reinterpret_cast<void* const*>(base + 0x7f9a0);
    if (!dialog || !variableContext) fail("native_dialogue_singletons_unavailable");

    auto allocate = reinterpret_cast<NativeAllocate>(base + 0x057cc);
    auto constructContext = reinterpret_cast<NativeAgeContextConstructor>(base + 0x38c54);
    auto loadAge = reinterpret_cast<NativeAgeLoader>(base + 0x38958);
    const uintptr_t variableVtable = *reinterpret_cast<const uintptr_t*>(variableContext);
    auto addVariable = reinterpret_cast<NativeAddVariable>(
        *reinterpret_cast<const uintptr_t*>(variableVtable + 0x18));
    auto setNumericVariable = reinterpret_cast<NativeSetNumericVariable>(
        *reinterpret_cast<const uintptr_t*>(variableVtable + 0x1c));
    auto rebuildDialog = reinterpret_cast<NativeDialogueRebuild>(base + 0x43220);
    auto closeDialog = reinterpret_cast<NativeDialogueClose>(base + 0x44000);

    void* ageContext = allocate(0x0c, 1, 0, 0);
    if (!ageContext) fail("native_dialogue_context_allocation_failed");
    constructContext(ageContext);
    *reinterpret_cast<void**>(dialog + 0x2d0) = ageContext;
    g_ageNodeAllocations.clear();
    g_captureAgeNodeAllocations = true;
    const int loaded = loadAge(ageContext, bytes.data(), static_cast<uint32_t>(bytes.size()), variableContext, 0, 0);
    g_captureAgeNodeAllocations = false;
    if (!loaded) fail("native_dialogue_age_load_failed");
    const size_t rawNodeAllocationCount = g_ageNodeAllocations.size();
    if (rawNodeAllocationCount != 241) fail("native_dialogue_node_allocation_count_mismatch");
    g_ageNodeAllocations.erase(g_ageNodeAllocations.begin());
    printf("{\"event\":\"native_age_node_allocations\",\"rawCount\":%lu,\"recordCount\":%lu}\n",
        static_cast<unsigned long>(rawNodeAllocationCount),
        static_cast<unsigned long>(g_ageNodeAllocations.size()));
    installNativeAgeEvaluatorTrace(module);

    *reinterpret_cast<int32_t*>(dialog + 0x2d4) = -1;
    *reinterpret_cast<int32_t*>(dialog + 0x2d8) = -1;
    *reinterpret_cast<uint32_t*>(dialog + 0x2cc) = 1;
    *reinterpret_cast<uint32_t*>(dialog + 0x2c0) = 0;
    *reinterpret_cast<uint32_t*>(dialog + 0x5528) = 0;
    memset(reinterpret_cast<void*>(dialog + 0x04), 0, 0xaf * sizeof(uint32_t));

    const char* numericVariables[] = {
        reinterpret_cast<const char*>(base + 0x91c64),
        reinterpret_cast<const char*>(base + 0x91c80),
        "demon_univ",
        "result",
    };
    for (const char* name : numericVariables) {
        if (addVariable(variableContext, name, 0, 0.0) != 0) fail("native_dialogue_variable_registration_failed");
    }

    printf("{\"event\":\"native_age_program\",\"asset\":\"scripts/dialogs/demon.d1.age.cs\",\"bytes\":%lu}\n",
        static_cast<unsigned long>(bytes.size()));
    setNumericVariable(variableContext, reinterpret_cast<const char*>(base + 0x91c80), 0.0);
    beginNativeAgeTrace(1);
    rebuildDialog(reinterpret_cast<void*>(dialog));
    endNativeAgeTrace();
    emitNativeDialogueSnapshot("opening", 0, dialog);
    const std::vector<uint8_t> openingPacket = encodeNativeDialogueSnapshotPacket(dialog);
    emitDialoguePacketBytes("server_to_client", "opening", openingPacket);
    const uint32_t replyCount = *reinterpret_cast<const uint32_t*>(dialog + 0x0c);
    if (replyCount == 0) fail("native_dialogue_opening_has_no_replies");
    const uint32_t firstReply = *reinterpret_cast<const uint32_t*>(dialog + 0x18);
    const uint32_t bridgedReply = applyNativeDialoguePacket(clientFacade, openingPacket, firstReply);
    const std::vector<uint8_t> replyPacket = encodeNativeDialogueReplyPacket(bridgedReply);
    emitDialoguePacketBytes("client_to_server", "first_reply", replyPacket);
    *reinterpret_cast<uint32_t*>(dialog + 0x5528) = 0;
    setNumericVariable(variableContext, reinterpret_cast<const char*>(base + 0x91c80), static_cast<double>(bridgedReply));
    beginNativeAgeTrace(2);
    rebuildDialog(reinterpret_cast<void*>(dialog));
    endNativeAgeTrace();
    emitNativeDialogueSnapshot("first_reply", static_cast<int32_t>(bridgedReply), dialog);
    const std::vector<uint8_t> firstReplySnapshotPacket = encodeNativeDialogueSnapshotPacket(dialog);
    emitDialoguePacketBytes("server_to_client", "first_reply", firstReplySnapshotPacket);
    applyNativeDialoguePacket(clientFacade, firstReplySnapshotPacket, 0);
    closeDialog(reinterpret_cast<void*>(dialog));
    printf("{\"event\":\"native_dialogue_closed\",\"active\":%lu,\"hasContext\":%s}\n",
        static_cast<unsigned long>(*reinterpret_cast<const uint32_t*>(dialog + 0x2cc)),
        *reinterpret_cast<void* const*>(dialog + 0x2d0) ? "true" : "false");
}

void loadApi(const ModuleSpec& spec, HMODULE* module, const char* exportName, uintptr_t* host, uintptr_t* table, bool initialize) {
    *module = LoadLibraryExW(modulePath(spec), nullptr, LOAD_WITH_ALTERED_SEARCH_PATH);
    if (!*module) {
        fprintf(stderr, "oracle_error LoadLibraryExW_failed module=%ls code=%lu path=%ls\n", spec.label, GetLastError(), modulePath(spec));
        ExitProcess(2);
    }
    auto getApi = reinterpret_cast<GetApi>(GetProcAddress(*module, exportName));
    if (!getApi) fail("missing_api_export");
    printf("{\"event\":\"api_export\",\"module\":\"%ls\",\"name\":\"%s\"}\n", spec.label, exportName);
    fprintf(stderr, "oracle_api_call module=%ls host=0x%Ix table=0x%Ix first=0x%Ix\n", spec.label,
        reinterpret_cast<uintptr_t>(host), reinterpret_cast<uintptr_t>(table), table[0]);
    getApi(host, table);
    fprintf(stderr, "oracle_api_call module=%ls after_getApi\n", spec.label);
    dumpApi(spec.label, table, *module);
    if (g_probeConfigObject && strcmp(exportName, "GetClientAPI") == 0) installClientGraphicsProbe(*module);
    if (initialize && table[1]) {
        printf("{\"event\":\"initializer_call\",\"module\":\"%ls\",\"offset\":4}\n", spec.label);
        const uintptr_t initializer = table[1];
        fprintf(stderr, "oracle_initializer module=%ls before_call target=0x%Ix table=0x%Ix esp=0x%Ix\n",
            spec.label, initializer, reinterpret_cast<uintptr_t>(table), currentStackPointer());
        reinterpret_cast<Initializer>(initializer)();
        fprintf(stderr, "oracle_initializer module=%ls after_call target=0x%Ix table=0x%Ix esp=0x%Ix\n",
            spec.label, initializer, reinterpret_cast<uintptr_t>(table), currentStackPointer());
        dumpApi(spec.label, table, *module);
    }
}

} // namespace

int wmain(int argc, wchar_t** argv) {
    bool serverOnly = false;
    setvbuf(stderr, nullptr, _IONBF, 0);
    setvbuf(stdout, nullptr, _IONBF, 0);
    SetUnhandledExceptionFilter(oracleExceptionFilter);
    bool initialize = false;
    bool useObjectFacades = false;
    wchar_t gameRoot[MAX_PATH]{};
    const wchar_t* candidates[] = { L"E:\\Games\\GoldenLand2Original", L"E:\\Games\\zlato22" };
    for (const wchar_t* candidate : candidates) {
        const DWORD attributes = GetFileAttributesW(candidate);
        if (attributes != INVALID_FILE_ATTRIBUTES && (attributes & FILE_ATTRIBUTE_DIRECTORY)) {
            if (!copyPath(gameRoot, candidate)) fail("game_root_path_too_long");
            break;
        }
    }
    if (!gameRoot[0] && !copyPath(gameRoot, L"E:\\Games\\zlato22")) fail("game_root_path_too_long");

    for (int index = 1; index < argc; ++index) {
        if (wcscmp(argv[index], L"--initialize") == 0) {
            initialize = true;
        } else if (wcscmp(argv[index], L"--host-facades") == 0) {
            useObjectFacades = true;
        } else if (wcscmp(argv[index], L"--probe-config-object") == 0) {
            g_probeConfigObject = true;
        } else if (wcscmp(argv[index], L"--server-only") == 0) {
            serverOnly = true;
        } else if (wcscmp(argv[index], L"--quiet-stubs") == 0) {
            g_quietHostStubs = true;
        } else if (wcscmp(argv[index], L"--invoke-native-dialog") == 0) {
            g_invokeNativeDialog = true;
        } else if (wcscmp(argv[index], L"--invoke-native-scr") == 0) {
            g_invokeNativeScr = true;
        } else if (wcscmp(argv[index], L"--invoke-native-scr-core") == 0) {
            g_invokeNativeScrCore = true;
        } else if (wcscmp(argv[index], L"--invoke-native-scr-core-real") == 0) {
            g_invokeNativeScrCoreReal = true;
        } else if (wcscmp(argv[index], L"--invoke-native-scr-trigger") == 0) {
            g_invokeNativeScrTrigger = true;
        } else if (wcscmp(argv[index], L"--invoke-native-scr-effect") == 0) {
            g_invokeNativeScrEffect = true;
        } else if (wcscmp(argv[index], L"--invoke-native-level") == 0) {
            g_invokeNativeLevel = true;
        } else if (wcscmp(argv[index], L"--asset-root") == 0 && index + 1 < argc) {
            g_assetRoot = narrowPath(argv[++index]);
        } else if (wcscmp(argv[index], L"--game-root") == 0 && index + 1 < argc) {
            if (!copyPath(gameRoot, argv[++index])) fail("game_root_path_too_long");
        } else {
            fail("unknown_argument_or_missing_game_root");
        }
    }
    g_gameRoot = narrowPath(gameRoot);
    if (!SetDllDirectoryW(gameRoot)) {
        fprintf(stderr, "oracle_warn SetDllDirectoryW_failed code=%lu root=%ls\n", GetLastError(), gameRoot);
    }

    ModuleSpec server = kServer;
    ModuleSpec client = kClient;
    if (swprintf(server.resolvedPath, MAX_PATH, L"%ls\\Server.dll", gameRoot) < 0
        || swprintf(client.resolvedPath, MAX_PATH, L"%ls\\Client.dll", gameRoot) < 0) {
        fail("game_root_path_too_long");
    }

    verifyModule(server);
    verifyModule(client);

    uintptr_t serverHost[kHostSlots]{};
    uintptr_t clientHost[kHostSlots]{};
    for (size_t index = 0; index < kHostSlots; ++index) {
        serverHost[index] = reinterpret_cast<uintptr_t>(kHostStubs[index]);
        clientHost[index] = reinterpret_cast<uintptr_t>(kHostStubs[index]);
    }
    serverHost[0] = 1;
    clientHost[0] = 1;
    if (useObjectFacades) {
        initializeHostObjectFacade();
        serverHost[0x04 / sizeof(uintptr_t)] = reinterpret_cast<uintptr_t>(g_clientShortObject);
        clientHost[0x04 / sizeof(uintptr_t)] = reinterpret_cast<uintptr_t>(g_clientShortObject);
        serverHost[0x10 / sizeof(uintptr_t)] = reinterpret_cast<uintptr_t>(g_hostObject);
        clientHost[0x10 / sizeof(uintptr_t)] = reinterpret_cast<uintptr_t>(g_hostObject);
        serverHost[0x1c / sizeof(uintptr_t)] = reinterpret_cast<uintptr_t>(g_hostObject);
        clientHost[0x1c / sizeof(uintptr_t)] = reinterpret_cast<uintptr_t>(g_hostObject);
        serverHost[0x24 / sizeof(uintptr_t)] = reinterpret_cast<uintptr_t>(g_serverLookupService);
        serverHost[0x78 / sizeof(uintptr_t)] = reinterpret_cast<uintptr_t>(g_serverPersonLookupService);
        serverHost[0x98 / sizeof(uintptr_t)] = reinterpret_cast<uintptr_t>(g_serverEntityService);
        serverHost[0x9c / sizeof(uintptr_t)] = reinterpret_cast<uintptr_t>(g_serverDescriptorService);
        serverHost[0xa0 / sizeof(uintptr_t)] = reinterpret_cast<uintptr_t>(g_serverItemService);
        serverHost[0x8c / sizeof(uintptr_t)] = reinterpret_cast<uintptr_t>(g_hostObject);
        clientHost[0x8c / sizeof(uintptr_t)] = reinterpret_cast<uintptr_t>(g_hostObject);
        serverHost[0x94 / sizeof(uintptr_t)] = reinterpret_cast<uintptr_t>(g_hostObject);
        clientHost[0x94 / sizeof(uintptr_t)] = reinterpret_cast<uintptr_t>(g_hostObject);
        serverHost[0xa4 / sizeof(uintptr_t)] = reinterpret_cast<uintptr_t>(g_serverLevelService);
        clientHost[0xa4 / sizeof(uintptr_t)] = reinterpret_cast<uintptr_t>(g_hostObject);
        serverHost[0xa8 / sizeof(uintptr_t)] = reinterpret_cast<uintptr_t>(g_serverWorldService);
        clientHost[0x9c / sizeof(uintptr_t)] = reinterpret_cast<uintptr_t>(g_hostRegistryObject);
        if (g_invokeNativeLevel) {
            serverHost[0xcc / sizeof(uintptr_t)] =
                reinterpret_cast<uintptr_t>(&serverGlobalServiceMethod);
        }
        if (g_probeConfigObject) clientHost[0x90 / sizeof(uintptr_t)] = reinterpret_cast<uintptr_t>(g_clientGlobalObject);
        if (g_probeConfigObject) {
            serverHost[0x14 / sizeof(uintptr_t)] = reinterpret_cast<uintptr_t>(g_hostInternalObject);
            clientHost[0x14 / sizeof(uintptr_t)] = reinterpret_cast<uintptr_t>(g_clientResourceObject);
            clientHost[0x24 / sizeof(uintptr_t)] = reinterpret_cast<uintptr_t>(g_clientFileObject);
            clientHost[0x70 / sizeof(uintptr_t)] = reinterpret_cast<uintptr_t>(g_clientFileObject);
            clientHost[0x74 / sizeof(uintptr_t)] = reinterpret_cast<uintptr_t>(g_clientFileObject);
        }
    }
    uintptr_t serverTable[kModuleSlots]{};
    uintptr_t clientTable[kModuleSlots]{};

    loadApi(server, &g_server, "GetServerAPI", serverHost, serverTable, initialize);
    if (serverOnly) {
        printf("{\"event\":\"api_skip\",\"module\":\"Client.dll\"}\n");
    } else {
        loadApi(client, &g_client, "GetClientAPI", clientHost, clientTable, initialize);
    }
    if (g_invokeNativeScr || g_invokeNativeScrCore || g_invokeNativeScrCoreReal) {
        if (!initialize) fail("native_scr_requires_initialized_modules");
        const bool core = g_invokeNativeScrCore || g_invokeNativeScrCoreReal;
        invokeNativeScrFunction(g_server, core, g_invokeNativeScrCore);
    }
    if (g_invokeNativeScrTrigger) {
        if (!initialize) fail("native_scr_trigger_requires_initialized_modules");
        invokeNativeScrTrigger(g_server);
    }
    if (g_invokeNativeScrEffect) {
        if (!initialize) fail("native_scr_effect_requires_initialized_modules");
        invokeNativeScrEffect(g_server);
    }
    if (g_invokeNativeLevel) {
        if (!initialize) fail("native_level_requires_initialized_modules");
        invokeNativeLevel(serverTable[0x10 / sizeof(uintptr_t)]);
    }
    if (g_invokeNativeDialog) {
        if (!initialize) fail("native_dialogue_requires_initialized_modules");
        invokeNativeDialogFunction(g_server, serverOnly ? 0 : clientTable[0x18 / sizeof(uintptr_t)]);
    }
    printf("{\"event\":\"oracle_complete\",\"initialized\":%s}\n", initialize ? "true" : "false");
    return 0;
}

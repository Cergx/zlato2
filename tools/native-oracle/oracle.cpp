// GoldenLand executable-first oracle.
// Build in a Win32 developer prompt, never an x64 prompt:
//   call "%ProgramFiles(x86)%\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Auxiliary\\Build\\vcvars32.bat"
//   cl /nologo /EHsc /W4 /O2 oracle.cpp bcrypt.lib gdi32.lib /link /MACHINE:X86 /SUBSYSTEM:CONSOLE
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
#else
#define ORACLE_THISCALL __attribute__((thiscall))
#define ORACLE_CDECL __attribute__((cdecl))
#endif

using GetApi = void (__cdecl*)(void*, void*);
using Initializer = void (__cdecl*)(void);

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
// The first forwarded word is provisionally treated as a size-or-tag value; native ownership is unconfirmed.
static uintptr_t ORACLE_THISCALL hostObjectAllocateMethod(void*, uintptr_t requestedSizeOrTag, uintptr_t, uintptr_t) {
    logHostCall(1);
    constexpr size_t kMinimumAllocationSize = 0x10000;
    const size_t requested = requestedSizeOrTag;
    const size_t size = requested >= kMinimumAllocationSize && requested <= 0x1000000
        ? requested : kMinimumAllocationSize;
    void* memory = calloc(1, size);
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
    g_hostResultObject[0] = reinterpret_cast<uintptr_t>(g_hostObjectVtable);
    g_hostResultObject[0x8c / sizeof(uintptr_t)] = 1;
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
using NativeScriptFunction = double (__cdecl*)(void);
void traceNativeScriptFunction(HMODULE module, const char* name, uintptr_t rva) {
    const uintptr_t address = reinterpret_cast<uintptr_t>(module) + rva;
    const double result = reinterpret_cast<NativeScriptFunction>(address)();
    printf("{\"event\":\"native_script_function\",\"name\":\"%s\",\"address\":\"0x%Ix\",\"result\":%.17g}\n", name, address, result);
}
void invokeNativeDialogFunction(HMODULE module) {
    traceNativeScriptFunction(module, "D_Say", 0x3fc10);
    traceNativeScriptFunction(module, "D_Answer", 0x3fc60);
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
        if (g_invokeNativeDialog && strcmp(exportName, "GetServerAPI") == 0) invokeNativeDialogFunction(*module);
    }
}

} // namespace

int wmain(int argc, wchar_t** argv) {
    bool serverOnly = false;
    setvbuf(stderr, nullptr, _IONBF, 0);
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
        serverHost[0x04 / sizeof(uintptr_t)] = reinterpret_cast<uintptr_t>(g_hostShortObject);
        clientHost[0x04 / sizeof(uintptr_t)] = reinterpret_cast<uintptr_t>(g_clientShortObject);
        serverHost[0x10 / sizeof(uintptr_t)] = reinterpret_cast<uintptr_t>(g_hostObject);
        clientHost[0x10 / sizeof(uintptr_t)] = reinterpret_cast<uintptr_t>(g_hostObject);
        serverHost[0x1c / sizeof(uintptr_t)] = reinterpret_cast<uintptr_t>(g_hostObject);
        clientHost[0x1c / sizeof(uintptr_t)] = reinterpret_cast<uintptr_t>(g_hostObject);
        serverHost[0x8c / sizeof(uintptr_t)] = reinterpret_cast<uintptr_t>(g_hostObject);
        clientHost[0x8c / sizeof(uintptr_t)] = reinterpret_cast<uintptr_t>(g_hostObject);
        serverHost[0x94 / sizeof(uintptr_t)] = reinterpret_cast<uintptr_t>(g_hostObject);
        clientHost[0x94 / sizeof(uintptr_t)] = reinterpret_cast<uintptr_t>(g_hostObject);
        serverHost[0xa4 / sizeof(uintptr_t)] = reinterpret_cast<uintptr_t>(g_hostObject);
        clientHost[0xa4 / sizeof(uintptr_t)] = reinterpret_cast<uintptr_t>(g_hostObject);
        clientHost[0x9c / sizeof(uintptr_t)] = reinterpret_cast<uintptr_t>(g_hostRegistryObject);
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
    printf("{\"event\":\"oracle_complete\",\"initialized\":%s}\n", initialize ? "true" : "false");
    return 0;
}

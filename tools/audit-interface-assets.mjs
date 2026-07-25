import { readdir, readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const assetsRoot = resolve(root, "public/assets");
const interfaceRoots = [
    resolve(assetsRoot, "engineres/interface"),
    resolve(assetsRoot, "engineres/gpanel"),
];
const sourceRoots = [resolve(root, "src"), resolve(assetsRoot, "scripts")];
const textExtensions = new Set([".ts", ".tsx", ".scss", ".css", ".scr"]);

const walk = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map((entry) => {
        const path = resolve(directory, entry.name);
        return entry.isDirectory() ? walk(path) : [path];
    }));
    return nested.flat();
};

const normalize = (value) => value.replaceAll("\\", "/").toLowerCase();
const assetFiles = (await Promise.all(interfaceRoots.map(walk))).flat();
const sourceFiles = (await Promise.all(sourceRoots.map(walk))).flat()
    .filter((path) => textExtensions.has(extname(path).toLowerCase()));
const corpus = normalize((await Promise.all(sourceFiles.map((path) => readFile(path, "utf8")))).join("\n"));

const isReferenced = (path) => {
    const assetPath = normalize(relative(assetsRoot, path));
    const assetStem = assetPath.slice(0, -extname(assetPath).length);
    const tail = assetPath.startsWith("engineres/") ? assetPath.slice("engineres/".length) : assetPath;
    const tailStem = tail.slice(0, -extname(tail).length);
    if ([assetPath, assetStem, tail, tailStem].some((candidate) => corpus.includes(candidate))) return true;

    const basename = assetStem.slice(assetStem.lastIndexOf("/") + 1);
    if (assetPath.includes("/magic_book/magic_icons/") && corpus.includes(basename)) return true;
    if (assetPath.includes("/about_menu/slide/") && corpus.includes("about_menu/slide/${")) return true;
    if (assetPath.includes("/loading_jpg/background_") && corpus.includes("loading_jpg/background_${")) return true;
    return false;
};

const candidates = assetFiles.filter((path) => !isReferenced(path))
    .map((path) => normalize(relative(assetsRoot, path)))
    .sort();
const groups = new Map();
for (const path of candidates) {
    const group = path.split("/").slice(0, 3).join("/");
    groups.set(group, (groups.get(group) ?? 0) + 1);
}

console.log(`Interface assets: ${assetFiles.length}`);
console.log(`Referenced by runtime/authored GUI: ${assetFiles.length - candidates.length}`);
console.log(`Unreferenced candidates: ${candidates.length}`);
for (const [group, count] of [...groups].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))) {
    console.log(`${String(count).padStart(3)}  ${group}`);
}
console.log("\nCandidates:");
for (const path of candidates) console.log(path);

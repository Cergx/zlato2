/// <reference types="vite/client" />

declare module "virtual:item-mask-manifest" {
    const itemMaskUrlsByIconUrl: Readonly<Record<string, string>>;
    export default itemMaskUrlsByIconUrl;
}

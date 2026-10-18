// wasm.d.ts

declare module '*.wasm' {
    const content: string;
    export default content;
}
declare module 'opencc-js/t2cn' {
  export function Converter(options: { from: string; to: string }): (text: string) => string;
}

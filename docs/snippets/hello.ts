// 用 `pnpm ex docs/snippets/hello.ts` 运行这个文件（无需先编译）
const greet = (name: string): string => `Hello, ${name}!`;

console.log(greet('TypeScript'));
console.log('Node 版本:', process.version);

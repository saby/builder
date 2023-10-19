import type { MyType } from './type';

export default class MyClass {
   private readonly _a: string;
   private readonly _b: number;

   constructor(a: MyType, b: number) {
      this._a = a.toString();
      this._b = b;
   }

   generate(): string {
      return this._a.repeat(this._b);
   }
}

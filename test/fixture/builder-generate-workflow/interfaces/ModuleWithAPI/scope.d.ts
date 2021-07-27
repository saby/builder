export module scope {
    interface IFoo {
        foo: string;
    }
    export interface User {
        get(): IFoo;
    }
}
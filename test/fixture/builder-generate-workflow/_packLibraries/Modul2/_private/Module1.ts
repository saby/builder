'use strict';

class MyClass {
    protected test1:string;
    private test2:[];
    constructor(test1, test2) {
        this.test1 = test1;
        this.test2 = test2;
    }

    get classArray() {
        return this.test2;
    }

    set classArray(value) {
        this.test2 = value;
    }
}

export default MyClass;
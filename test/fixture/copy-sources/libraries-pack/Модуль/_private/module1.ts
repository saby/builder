'use strict';

class Test {
    private stringField;
    constructor(string) {
        this.stringField = string;
    }
    async getString() {
        return this.stringField.toLowerCase();
    }
}
export = Test;
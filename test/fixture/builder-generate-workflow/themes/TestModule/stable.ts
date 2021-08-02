'use strict';

import "css!TestModule/Stable-for-import";
import "css!theme?TestModule/Stable-for-theme-import";
export default class Test {
    private variables: [];
    private _theme: [string];
    private _styles: [string];
    private defaultStyles: {};
    constructor(variable: []) {
        this.variables = variable;
        this.defaultStyles = {
            _theme: ['TestModule/test-theme-object'],
            _style: ['TestModule/test-style-object'],
            _styles: ['TestModule/test-styles-object'],
        };
        this._theme = ['TestModule/Stable-with-import'];
        this._styles = ['TestModule/test-style-assign'];
    }
};
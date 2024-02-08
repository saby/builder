'use strict';

import template = require('wml!./test');

async function testFunction() {
    return { tplFn: template };
}

export default testFunction;

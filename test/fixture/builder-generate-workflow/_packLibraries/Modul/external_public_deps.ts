'use strict';
// @ts-ignore
import * as Module_1 from './Modul';
// @ts-ignore
import * as testFunction_1 from './publicFunction1';
// @ts-ignore
import * as testFunction_2 from './_es6/testPublicModule';

export = {
   default: Module_1,
   simpleArrayFunction: testFunction_1,
   removeArrayDuplicates: testFunction_2
};

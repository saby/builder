'use strict';

import * as rk from 'i18n!Modul/_es6/Modul';
import Module_es5 from '../_es5/Module.js';
// @ts-ignore
import * as simpleArraySort from '../publicFunction1';
export default Module_es5;
function someTest() {
   var test1 = rk('Тестовое сообщение');
   var test2 = simpleArraySort([]);
   return { test1, test2 };
}
export { someTest };

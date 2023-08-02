'use strict';

import "css!MyModule1/_private/moduleStyle";

class Module1 {
   private stringVar: 'string';
   private numberVar: 'number';
   constructor(test1: 'string', test2: 'number') {
      this.stringVar = test1;
      this.numberVar = test2;
   }
}
export default Module1;
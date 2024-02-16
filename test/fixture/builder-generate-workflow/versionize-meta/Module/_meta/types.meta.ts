'use strict';

import * as templateContent from 'tmpl!Module/_private/TimeTester';

class TestClass {
   protected template = templateContent;

   toJSON() {
      return {
         is: "primitive",
         id: "internalWidget",
         inherits: [],
         required: true,
         info: {},
         attributes: []
      };
   }
}

export default new TestClass();

'use strict';

const logger = require('../../../../lib/logger').logger();

class Progress {
   constructor() {
      this.current = 0;
      this.total = 0;
   }

   generatePrintProgressTask() {
      this.total += 1;

      const self = this;
      return function printProgress(done) {
         self.current += 1;

         logger.progress(100 * self.current / self.total);
         done();
      };
   }
}

module.exports = Progress;

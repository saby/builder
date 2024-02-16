/**
 * Get logs level from Node.Js process arguments
 */

'use strict';

module.exports = function getLogsLevel(processArgs) {
   let logLevel = '';
   processArgs.forEach((currentArg) => {
      if (currentArg.includes('log-level')) {
         logLevel = currentArg.slice(
            currentArg.indexOf('=') + 1,
            currentArg.length
         );
      }
   });
   return logLevel;
};

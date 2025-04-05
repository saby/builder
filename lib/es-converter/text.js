/**
 * @author Krylov M.A.
 */
'use strict';

function substitute(substitutions, source, shift) {
   // Modify original source text from the end
   substitutions.sort((a, b) => a.range[0] - b.range[0]);

   let resultSource = source;
   for (let i = substitutions.length - 1; i >= 0; --i) {
      const task = substitutions[i];

      resultSource = (
         resultSource.slice(0, task.range[0] - shift) +
         task.value +
         resultSource.slice(task.range[1] - shift)
      );
   }

   return resultSource;
}

module.exports = {
   substitute
};

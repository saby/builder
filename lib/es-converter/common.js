/**
 * @author Krylov M.A.
 */

'use strict';

const sourceMap = require('../source-map');

function hasEqualType(program, structure) {
   if (Array.isArray(structure.type)) {
      return structure.type.some(t => t === program.type);
   }

   return program.type === structure.type;
}

function parseIfMatch(program, structure, storage) {
   if (!hasEqualType(program, structure)) {
      return false;
   }

   if (typeof structure.test === 'function') {
      if (!structure.test(program)) {
         return false;
      }
   }

   if (typeof structure.parse === 'function') {
      structure.parse(program, storage);
   }

   if (structure.props) {
      for (const prop of structure.props) {
         if (!Array.isArray(structure[prop])) {
            if (parseIfMatch(program[prop], structure[prop], storage)) {
               continue;
            }

            return false;
         }

         let pIndex = 0;
         let sIndex = 0;
         let shift = program[prop].length - structure[prop].length;

         if (shift < 0) {
            return false;
         }

         while (pIndex < program[prop].length && sIndex < structure[prop].length) {
            if (parseIfMatch(program[prop][pIndex], structure[prop][sIndex], storage)) {
               ++pIndex;
               ++sIndex;
               continue;
            }

            if (shift === 0) {
               return false;
            }

            --shift;
            ++pIndex;
            sIndex = 0;
         }
      }
   }

   return true;
}

function parseSourceMap(program, storage) {
   if (Array.isArray(program.comments)) {
      for (const comment of program.comments) {
         const jsonSourceMap = sourceMap.fromComment(comment.value);

         if (jsonSourceMap) {
            storage.inlineSourceMap = true;
            storage.inlineSourceMapRange = comment.range;
            storage.sourceMap = jsonSourceMap;
         }
      }
   }

   return undefined;
}

function parse(program, structure) {
   const storage = { };

   if (parseIfMatch(program, structure, storage)) {
      parseSourceMap(program, storage);

      return storage;
   }

   return undefined;
}

module.exports = {
   parse
};

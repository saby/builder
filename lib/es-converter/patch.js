'use strict';

const { parseCode } = require('../espree/common');
const modifyPromiseCatch = require('../espree/modify-promise-catch');

function patch(program, source, options) {
   const patchedSource = modifyPromiseCatch(program);

   if (!patchedSource) {
      return [program, source];
   }

   const patchedProgram = parseCode(patchedSource, '', { comment: true, ecmaVersion: options.ESVersion });

   return [patchedProgram, patchedSource];
}

module.exports = patch;

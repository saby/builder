/**
 * @author Krylov M.A.
 */
'use strict';

const fs = require('fs-extra');

const writeJsonOptions = {
   encoding: 'utf-8',
   spaces: 3,
   replacer: (key, value) => {
      if (value instanceof Map) {
         return Array.from(value);
      }

      if (value instanceof Set) {
         return Array.from(value.keys());
      }

      return value;
   }
};

function writeJsonArtifact(filePath, contents) {
   return fs.writeJson(
      filePath,
      contents,
      writeJsonOptions
   );
}

function filterTargetModule(moduleInfo) {
   return !(
      moduleInfo.name.endsWith('-icons') ||
      moduleInfo.name.endsWith('-theme') ||
      moduleInfo.name.endsWith('Unit') ||
      moduleInfo.name.endsWith('Test') ||
      moduleInfo.name.endsWith('Tests')
   );
}

module.exports = {
   writeJsonArtifact,
   filterTargetModule
};

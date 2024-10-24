'use strict';

/**
 * набор начал путей интерфейсных модулей, которые необходимо
 * заменить в соответствии с их использованием в require
 * Взято из актуального конфига для requirejs: ws/ext/requirejs/config.js
 */
const { requireJsSubstitutions } = require('./builder-constants');
const { removeLeadingSlashes } = require('./platform/path');

function getRequireName(filePath) {
   const pathParts = filePath.split('/');
   let filePathPart, requireName;

   pathParts.pop();
   while (pathParts.length !== 0 && requireName === undefined) {
      filePathPart = pathParts.join('/');
      requireName = requireJsSubstitutions.get(filePathPart);
      pathParts.pop();
   }
   return requireName !== undefined ? filePathPart : null;
}

function getPrettyPath(filePath) {
   let resultPath = filePath;
   const requireNameToReplace = getRequireName(resultPath);
   if (requireNameToReplace !== null) {
      resultPath = removeLeadingSlashes(
         resultPath.replace(requireNameToReplace, requireJsSubstitutions.get(requireNameToReplace))
      );
   }
   return resultPath;
}

function normalizeModuleName(filePath) {
   if (filePath.startsWith('react/')) {
      return 'React';
   }

   const firstModulePart = filePath.split('/').shift();

   let resultPath = filePath;
   requireJsSubstitutions.forEach((value, key) => {
      if (firstModulePart === value) {
         resultPath = resultPath.replace(firstModulePart, key);
      }
   });
   return resultPath;
}

module.exports = {
   getPrettyPath,
   normalizeModuleName
};

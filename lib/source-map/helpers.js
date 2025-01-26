/**
 * Модуль вспомогательных функций для работы с source map.
 * @author Krylov M.A.
 */

'use strict';

const fs = require('fs-extra');

const { path } = require('../platform/path');

function toComment(jsonSourceMap) {
   const data = Buffer.from(JSON.stringify(jsonSourceMap)).toString('base64');

   return `//# sourceMappingURL=data:application/json;base64,${data}`;
}

function fromComment(jsonSourceMapComment) {
   const sourceMappingURLRe = /^[@#]\s+?sourceMappingURL=data:(((?:application|text)\/json)(?:;charset=([^;,]+?)?)?)?(?:;(base64))?,(.*?)$/m;

   if (!sourceMappingURLRe.test(jsonSourceMapComment)) {
      return undefined;
   }

   const re = sourceMappingURLRe.exec(jsonSourceMapComment);
   const base64Data = re && re[5];

   return JSON.parse(Buffer.from(base64Data, 'base64'));
}

function isCoverageProject(taskParameters) {
   // TODO: Не очень красивое решение. Необходимо проработать структуру конфигурационного файла
   //  и регулировать поведение сборки только с помощью его.
   //  Необходимо в конфигурационном файле поддержать опцию sourceRoot со значениями "source", "output".
   return (
      taskParameters.config.outputPath.includes('/Controls-coverage/') &&
      taskParameters.config.logFolder.includes('/coverage_withUnit/')
   );
}

async function getRealFilePath(filePath) {
   try {
      return path.normalize(await fs.promises.realpath(filePath));
   } catch (_e) {
      // real path might lead to shared volume (win32 shared, docker mounted)
      // and fs.promises.realpath will fail
      return filePath;
   }
}

async function createSourceMapPaths(taskParameters, moduleInfo, file) {
   // Необходимо определять корректно пути до исходных файлов, чтобы работали точки останова и покрытие
   // Определяем sourceRoot как директорию, которая содержит UI-модуль.
   // Опеределяем sourceFile как путь от UI-модуля включительно.
   let { sourceRoot } = moduleInfo;
   if (!sourceRoot) {
      const realSourceRoot = await getRealFilePath(moduleInfo.path);
      sourceRoot = path.dirname(realSourceRoot);

      moduleInfo.sourceRoot = sourceRoot;
   }

   const realSourceFile = await getRealFilePath(file.history[0]);
   const sourceFile = path.relative(sourceRoot, realSourceFile);
   const fileName = path.basename(sourceFile).replace(/\.(js|tsx?)$/, '.js');

   if (isCoverageProject(taskParameters)) {
      // В локальных сборках sourceRoot указывает на директорию, содержащую интерфейсный модуль с исходными файлами.
      // Это необходимо для снятия работы отладчика и снятия покрытия через IDE.
      // В сборках покрытия sourceRoot указывает на директорию, содержащую скомпилированный интерфейсный модуль.
      // Это необходимо для консистентного отображения отчета. В противном случае часть файлов
      // ссылается на git_repos/_repos/**, а другая часть на workspace.
      sourceRoot = taskParameters.config.outputPath;
   }

   return { sourceRoot, sourceFile, fileName };
}

module.exports = {
   toComment,
   fromComment,
   createSourceMapPaths
};

/* eslint-disable no-sync */
/**
 * @author Kolbeshin F.A.
 */

'use strict';

const { path } = require('../../../lib/platform/path');
const fs = require('fs-extra'),
   transliterate = require('../../../lib/transliterate');

const ILLEGAL_SYMBOLS_FOR_PATH = ['[', ']'];

// функция проверяет, существует ли указанный путь. fs.pathExistsSync
// не умеет определять существование битых симлинков, поэтому нужно в
// таком случае проверять существование через lstatSync
function existsSync(currentPath) {
   try {
      fs.lstatSync(currentPath);
      return true;
   } catch (err) {
      if (err.code === 'ENOENT') {
         return true;
      }

      if (err.code !== 'EEXIST') {
         throw err;
      }

      return false;
   }
}

/**
 * Класс с базовой информацией о модуле. Используется как база для сборки статики и для сбора фраз локализации.
 */
class ModuleInfo {
   constructor(baseModuleInfo) {
      const {
         id,
         name,
         responsible,
         required,
         rebuild,
         depends,
         fullDependsTree,
         changedFiles,
         deletedFiles,
         featuresRequired,
         featuresProvided,
         description,
         forceRebuild,
         hash,
         compiled,
         kaizen,
         ESVersion,
         typescript,
         parse
      } = baseModuleInfo;
      const modulePath = baseModuleInfo.path;
      this.id = id;
      this.name = name;
      this.hash = hash;
      this.compiled = compiled;
      this.kaizen = kaizen;
      this.responsible = responsible;
      this.description = description;
      this.path = modulePath;
      this.parse = parse;
      this.required = required;
      this.rebuild = rebuild;
      this.depends = depends || [];
      this.fullDependsTree = fullDependsTree || [];
      this.cache = {};
      this.featuresRequired = featuresRequired || [];
      this.featuresProvided = featuresProvided || [];
      this.appRoot = path.dirname(modulePath);
      if (changedFiles) {
         this.setDefaultChangedFiles();
         changedFiles.forEach((currentFile) => {
            this.checkForCommonExtensions(currentFile);
            this.addFileToList('changedFiles', currentFile);
         });
      }

      this.deletedFiles = [];
      if (deletedFiles) {
         deletedFiles.forEach((currentFile) => {
            this.checkForCommonExtensions(currentFile);
            this.addFileToList('deletedFiles', currentFile);
         });
      }

      this.forceRebuild = !!forceRebuild;

      // check file hash is enabled by default, otherwise compile it
      // even if source file hash has same value as one in builder cache
      this.fileHashCheck = true;
      this.externalDependencies = new Set([]);
      this.ESVersion = ESVersion;

      // FIXME: Вместо 2021 используем 2019. После завершения проекта, вернуть обратно
      //   https://online.sbis.ru/opendoc.html?guid=275e9e3b-1973-44a9-af21-f922019564fd&client=3
      if (this.ESVersion === 2021) {
         this.ESVersion = 2019;
      }

      this.typescript = validateTypescriptInfo(typescript);
   }

   // проверяет на наличие в изменённых/удалённых файлах нужных расширений
   // и проставляет соответствующие флаги об изменениях в определённых функциональных
   // областях(tsc компиляция, сборка метатипов, генерация шрифтов)
   checkForCommonExtensions(currentFile) {
      if (currentFile.endsWith('.ts') || currentFile.endsWith('.tsx')) {
         this.typescriptChanged = true;
      }

      // в s3mod содержится мета(кайдзен, имя модуля и прочее), которая используется потом
      // при генерации метатипов. Соответственно при изменении s3mod нужно также перегенерить все
      // метатипы данного интерфейсного модуля.
      if (currentFile.endsWith('.meta.ts') || currentFile.endsWith('.s3mod')) {
         this.metaTsChanged = true;
      }

      // если в интерфейсном модуле иконок нету изменённых svg, то нет смысла перегенеривать шрифты
      if (currentFile.endsWith('.svg')) {
         this.svgChanged = true;
      }

      // если в интерфейсном модуле нету изменений в js-коде, то нет смысла запускать sbis3-json-generator
      // поскольку он генерит component-properties на основе только исходного js-кода
      if (currentFile.endsWith('.js')) {
         this.jsChanged = true;
      }
   }

   setDefaultChangedFiles() {
      this.changedFiles = [];
      this.normalizedChangedFiles = [];
   }

   addNormalizedChangedFile(currentFile) {
      if (!this.normalizedChangedFiles.includes(currentFile)) {
         this.normalizedChangedFiles.push(currentFile);
      }
   }

   addFileToList(type, currentFile) {
      if (!this[type].includes(currentFile)) {
         this[type].push(currentFile);
      }
   }

   addExternalDependencies(deps) {
      deps.forEach(currentDep => this.externalDependencies.add(currentDep));
   }

   get nameWithResponsible() {
      if (this.responsible) {
         return `${this.name} (${this.responsible})`;
      }
      return this.name;
   }

   get folderName() {
      return path.basename(this.path);
   }

   get runtimeModuleName() {
      return transliterate(this.folderName);
   }

   // если gulp не может обработать корректно путь до модуля, то попробуем сделать симлинк.
   symlinkInputPathToAvoidProblems(cachePath, buildTask, watcherRunning) {
      const needSymlink = buildTask || isShareOnWindows(this.path) || getIllegalSymbolInPath(this.path);
      if (needSymlink) {
         const newPath = path.join(cachePath, 'temp-modules', path.basename(this.path));

         // перед созданием симлинка надо удалить старый. Между сборками исходный модуль может менять расположение
         // Например в тестах по веткам модуль "intest" привязан к тестируемой ветке и может меняться расположение
         // кода между 2мя ветками
         if (!watcherRunning && existsSync(newPath)) {
            fs.removeSync(newPath);
         }

         // для Types в es5 спецификации необходимо в некоторых исходниках подменить .ts на
         // .ts.es5 поэтому симлинк использовать нельзя, ибо он может вести на шару, в которой
         // нет доступа на запись файлов(только на чтение)
         if (path.basename(newPath) === 'Types') {
            if (watcherRunning) {
               // В temp-modules находится не symlink, а копия. Поэтому необходимо скопировать
               // измененные файлы при работе watcher.
               if (Array.isArray(this.changedFiles)) {
                  this.changedFiles.forEach((fileName) => {
                     fs.copySync(path.join(this.path, fileName), path.join(newPath, fileName), { dereference: true });
                  });
               }

               this.path = newPath;
               this.appRoot = path.dirname(newPath);

               return;
            }

            fs.copySync(this.path, newPath, { dereference: true });
         } else {
            if (getIllegalSymbolInPath(newPath)) {
               throw new Error(`Временный пусть до модуля содержит не корректный символ "${getIllegalSymbolInPath(newPath)}"`);
            }
            if (isShareOnWindows(cachePath)) {
               throw new Error('На windows путь до кеша не может быть сетевым .');
            }
            try {
               fs.ensureSymlinkSync(this.path, newPath, 'dir');
            } catch (err) {
               const errorMessage = 'An error occurred while creating symlink:\n' +
                  `from: ${this.path}\n` +
                  `to: ${newPath}\n` +
                  'Make sure you\'re running your CLI or IDE with administrator rules(or with sudo rules in linux)\n' +
                  `Error: ${err.message}`;
               throw new Error(errorMessage);
            }
         }

         this.path = newPath;
         this.appRoot = path.dirname(newPath);
      }
   }
}

function getIllegalSymbolInPath(folderPath) {
   // Gulp не правильно работает, если в путях встречаются некоторые особые символы. Например, [ и ]
   for (const illegalSymbol of ILLEGAL_SYMBOLS_FOR_PATH) {
      if (folderPath.includes(illegalSymbol)) {
         return illegalSymbol;
      }
   }
   return '';
}

function isShareOnWindows(folderPath) {
   // gulp.src не умеет работать c сетевыми путями на windows
   if (process.platform === 'win32') {
      return folderPath.startsWith('//') || folderPath.startsWith('\\\\');
   }
   return false;
}

function validateTypescriptInfo(typescript) {
   if (!typescript) {
      // По мере расширения блока typescript здесь задаем значения по умолчанию.
      return {
         typecheck: true
      };
   }

   // Договоренность: jinnee и wasaby-cli передают данные "как есть".
   // Все s3mod файлы проинициализированы значением "0".
   if (typescript.typecheck === '0') {
      typescript.typecheck = false;
   }

   return typescript;
}

module.exports = ModuleInfo;

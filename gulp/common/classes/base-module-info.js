/* eslint-disable no-sync */
/**
 * @author Kolbeshin F.A.
 */

'use strict';

const { path } = require('../../../lib/platform/path');
const fs = require('fs-extra'),
   transliterate = require('../../../lib/transliterate');

const ILLEGAL_SYMBOLS_FOR_PATH = ['[', ']'];

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
         ESVersion
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
      this.required = required;
      this.rebuild = rebuild;
      this.depends = depends || [];
      this.fullDependsTree = fullDependsTree || [];
      this.cache = {};
      this.featuresRequired = featuresRequired || [];
      this.featuresProvided = featuresProvided || [];
      this.appRoot = path.dirname(modulePath);
      this.deletedFiles = deletedFiles || [];
      if (changedFiles) {
         this.setDefaultChangedFiles();
         changedFiles.forEach((currentFile) => {
            if (currentFile.endsWith('.ts') || currentFile.endsWith('.tsx')) {
               this.typescriptChanged = true;
            }
            this.addChangedFile(currentFile);
         });
      }
      this.forceRebuild = !!forceRebuild;

      // check file hash is enabled by default, otherwise compile it
      // even if source file hash has same value as one in builder cache
      this.fileHashCheck = true;
      this.externalDependencies = new Set([]);
      this.ESVersion = ESVersion;
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

   addChangedFile(currentFile) {
      if (!this.changedFiles.includes(currentFile)) {
         this.changedFiles.push(currentFile);
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

         // для Types в es5 спецификации необходимо в некоторых исходниках подменить .ts на
         // .ts.es5 поэтому симлинк использовать нельзя, ибо он может вести на шару, в которой
         // нет доступа на запись файлов(только на чтение)
         if (path.basename(newPath) === 'Types') {
            if (watcherRunning) {
               this.path = newPath;
               this.appRoot = path.dirname(newPath);
               return;
            }
            if (fs.pathExistsSync(newPath)) {
               fs.removeSync(newPath);
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

module.exports = ModuleInfo;

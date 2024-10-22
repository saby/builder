/**
 * @author Kolbeshin F.A.
 */

'use strict';

const fs = require('fs-extra');
const { path } = require('../../../lib/platform/path');
const Metrics = require('./metrics');

/**
 * Класс с базовой информацией для всех gulp задач.
 */
class TaskParameters {
   /**
    * @param {BuildConfiguration|GrabberConfiguration} config конфигурация сборки
    * @param {Cache} cache кеш сборки статики или сборка фраз локализации
    * @param {boolean} needGenerateJson нужна ли генерация json для локализации
    * @param {Pool} pool пул воркеров
    */
   constructor(config, cache, needGenerateJson = false, pool = null) {
      this.config = config;
      this.cache = cache;
      this.pool = pool;
      this.needGenerateJson = needGenerateJson;
      this.metrics = new Metrics(config.modules);
      this.versionedModules = {};
      this.cdnModules = {};
      this.librariesMeta = {};
      this.changedModules = new Set();
      this.themedModulesMap = new Map();
      this.lazyBundles = {};
      this.lazyBundlesMap = {};
      this.bundlesListIsChanged = false;
      this.packedFiles = new Set();
      this.filesToCopy = {};
      this.htmlTmplFiles = {};
   }

   setThemedModule(themedModuleName, originModuleName) {
      this.themedModulesMap.set(themedModuleName, originModuleName);
   }

   addFilesToCopy(moduleName, relativePaths) {
      if (!this.filesToCopy.hasOwnProperty(moduleName)) {
         this.filesToCopy[moduleName] = new Set();
      }

      relativePaths.forEach(relativePath => this.filesToCopy[moduleName].add(relativePath));
   }

   /**
    * Установить пул воркеров
    * @param {Pool} pool пул воркеров
    */
   setWorkerPool(pool) {
      this.pool = pool;
   }

   addChangedFile(fileName) {
      this.changedModules.add(fileName);
   }

   removeChangedFile(fileName) {
      this.changedModules.delete(fileName);
   }

   addLazyBundle(bundleName, externalDependencies, internalDependencies) {
      this.lazyBundles[bundleName] = {
         externalDependencies,
         internalModules: []
      };
      for (const module of internalDependencies.keys()) {
         if (this.lazyBundlesMap.hasOwnProperty(module)) {
            throw new Error(`Attempt to pack module ${module} from lazy package ${this.lazyBundlesMap[module]} to another lazy package`);
         } else {
            this.lazyBundlesMap[module] = bundleName;
            this.lazyBundles[bundleName].internalModules.push(module);
         }
      }
   }

   /**
    * recursively checks cyclic dependencies between external dependencies of lazy bundle and it's internal modules
    * @param dependencies
    * @param internalModules
    * @param currentModule
    * @param currentSequence
    * @returns {{sequence: [], cyclic: boolean}}
    */
   recursiveChecker(cyclicSequences, dependencies, internalModules, currentModule, currentSequence) {
      // catch all cyclic dependencies even if it's a cycle between 2 external dependencies of current lazy package
      if (currentSequence.includes(currentModule)) {
         currentSequence.push(currentModule);
         cyclicSequences.push(currentSequence);
         return currentSequence;
      }
      currentSequence.push(currentModule);

      // if current module creates cycle dependency, mark current sequence as cyclic
      // and return a result to log it properly to understand what happened
      if (
         currentSequence.length > 1 && internalModules.includes(currentModule)
      ) {
         cyclicSequences.push(currentSequence);
         return currentSequence;
      }
      const currentDependencies = dependencies[currentModule];
      if (currentDependencies) {
         currentDependencies.forEach((currentDependency) => {
            const newSequence = [...currentSequence];
            this.recursiveChecker(
               cyclicSequences,
               dependencies,
               internalModules,
               currentDependency,
               newSequence
            );
         });
      }
      return currentSequence;
   }

   checkLazyBundlesForCycles(dependencies) {
      const cyclicSequences = {};
      Object.keys(this.lazyBundles).forEach((currentLazyBundleName) => {
         const currentLazyBundle = this.lazyBundles[currentLazyBundleName];
         const result = [];

         // store external dependencies of bundle as dependencies of each lazy package internal module
         // to catch an issue when one lazy package has a cycle from another lazy package.
         this.lazyBundles[currentLazyBundleName].internalModules.forEach((currentInternalModule) => {
            if (dependencies[currentInternalModule]) {
               dependencies[`${currentInternalModule}_old`] = dependencies[currentInternalModule];
               const normalizedModuleDependencies = this.lazyBundles[currentLazyBundleName].externalDependencies;
               dependencies[currentInternalModule] = [currentLazyBundleName];
               dependencies[currentLazyBundleName] = normalizedModuleDependencies;
            }
         });
         currentLazyBundle.externalDependencies.forEach((externalDependency) => {
            this.recursiveChecker(
               result,
               dependencies,
               currentLazyBundle.internalModules,
               externalDependency,
               []
            );
         });
         if (result.length > 0) {
            cyclicSequences[currentLazyBundleName] = [];
            result.forEach((currentCycle) => {
               const externalEntryPoint = currentCycle[0];
               const dependingInternalModules = currentLazyBundle.internalModules.filter(
                  currentInternalModule => dependencies[currentInternalModule] &&
                     (dependencies[currentInternalModule].includes(externalEntryPoint) ||
                        dependencies[`${currentInternalModule}_old`].includes(externalEntryPoint))
               );

               // add internal module entry point to have an understanding which internal module
               // exactly have an external dependency that creates a cycle between the dependency and
               // another internal module of current lazy package
               dependingInternalModules.forEach(
                  currentInternalModule => cyclicSequences[currentLazyBundleName].push(
                     [currentInternalModule, ...currentCycle]
                  )
               );
            });
         }
      });
      return cyclicSequences;
   }

   async saveLazyBundles() {
      await fs.outputJson(
         path.join(this.config.cachePath, 'lazy-bundles.json'),
         this.lazyBundles
      );
   }

   async saveLazyBundlesMap() {
      await fs.outputJson(
         path.join(this.config.cachePath, 'lazy-bundles-map.json'),
         this.lazyBundlesMap
      );
   }

   addVersionedModules(moduleName, fileNames) {
      if (!this.versionedModules[moduleName]) {
         this.versionedModules[moduleName] = [];
      }

      fileNames.forEach((currentFileName) => {
         if (!this.versionedModules[moduleName].includes(currentFileName)) {
            this.versionedModules[moduleName].push(currentFileName);
         }
      });
   }

   getVersionedModules(moduleName) {
      if (!this.versionedModules[moduleName]) {
         this.versionedModules[moduleName] = [];
      }
      return this.versionedModules[moduleName];
   }

   addCdnModule(moduleName, fileName) {
      if (!this.cdnModules[moduleName]) {
         this.cdnModules[moduleName] = [];
      }
      if (!this.cdnModules[moduleName].includes(fileName)) {
         this.cdnModules[moduleName].push(fileName);
      }
   }

   getCdnModules(moduleName) {
      if (!this.cdnModules[moduleName]) {
         this.cdnModules[moduleName] = [];
      }
      return this.cdnModules[moduleName];
   }

   resetVersionedAndCdnMeta() {
      this.versionedModules = {};
      this.cdnModules = {};
   }

   filterMeta(moduleName, metaName, filterFunction) {
      if (this[metaName][moduleName]) {
         this[metaName][moduleName] = this[metaName][moduleName].filter(filterFunction);
      }
   }
}

module.exports = TaskParameters;

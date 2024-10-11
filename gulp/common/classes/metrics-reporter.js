'use strict';

const os = require('os');
const fs = require('fs-extra');

const { path } = require('../../../lib/platform/path');
const getBuildStatusStorage = require('../../common/classes/build-status');

const ModuleCategory = Object.freeze({
   Skipped: 'skipped',
   Built: 'built',
   Failed: 'failed'
});

function toMB(bytes) {
   return Math.floor(bytes / (1024 * 1024));
}

function toValidArray(value) {
   if (Array.isArray(value)) {
      return value;
   }

   return [];
}

function getMachineDetails() {
   return {
      host: os.hostname(),
      initialFreeMemory: toMB(os.freemem()),
      totalMemory: toMB(os.totalmem()),
      cpus: os.cpus().length
   };
}

function adjustWorkersNumber(config) {
   if (config.rawConfig.hasOwnProperty('max-workers-for-builder')) {
      return config.rawConfig['max-workers-for-builder'];
   }

   return (os.cpus().length - 1) || 1;
}

function getGroupedModules(modulesMap) {
   const modules = {
      skipped: [],
      built: [],
      failed: []
   };

   modulesMap.forEach((category, moduleName) => modules[category].push(moduleName));

   return modules;
}

class MetricsReporter {
   constructor() {
      this.stable = false;
      this.machine = getMachineDetails();

      this.typescriptCacheExists = true;
      this.builderCacheExists = true;
      this.cacheDrops = [];
   }

   applyConfiguration(config) {
      this.project = config.rawConfig.cld_name || 'unknown';
      this.workersNumber = adjustWorkersNumber(config);

      this.modules = new Map();

      config.modules.forEach(moduleInfo => this.modules.set(moduleInfo.outputName, ModuleCategory.Skipped));
   }

   applyOutputArtifacts(config, outputFiles) {
      this.changedModules = { };

      config.modules.forEach((moduleInfo) => {
         const changedFiles = toValidArray(moduleInfo.changedFiles);
         const deletedFiles = toValidArray(moduleInfo.deletedFiles);
         const outputArtifacts = toValidArray(outputFiles[moduleInfo.outputName]);

         if (changedFiles.length > 0 || deletedFiles.length > 0 || outputArtifacts.length > 0) {
            this.changedModules[moduleInfo.outputName] = {
               changedFiles,
               deletedFiles,
               outputArtifacts
            };
         }
      });
   }

   markBuiltModule(moduleInfo) {
      const status = this.modules.get(moduleInfo.outputName);

      if (status === ModuleCategory.Skipped) {
         this.modules.set(moduleInfo.outputName, ModuleCategory.Built);
      }
   }

   markFailedModule(moduleInfo) {
      this.modules.set(moduleInfo.outputName, ModuleCategory.Failed);

      getBuildStatusStorage().registerFailedModule(moduleInfo);
   }

   setTimings(timings) {
      this.timings = timings.map(item => ({
         name: item.Task,
         duration: item.Time
      }));
   }

   onCacheDrop(kind, reason) {
      this.cacheDrops.push({
         kind,
         reason
      });
   }

   save(directoryPath) {
      const reportFilePath = path.join(directoryPath, 'builder-metrics.json');

      // eslint-disable-next-line no-sync
      fs.outputJsonSync(reportFilePath, this.getJson(), {
         spaces: 3,
         encoding: 'utf-8'
      });
   }

   getJson() {
      if (!this.stable) {
         return {
            stable: this.stable,
            machine: this.machine,
            project: this.project,
            workersNumber: this.workersNumber,
         };
      }

      return {
         stable: this.stable,
         machine: this.machine,
         project: this.project,
         workersNumber: this.workersNumber,
         typescriptCacheExists: this.typescriptCacheExists,
         builderCacheExists: this.builderCacheExists,
         cacheDrops: this.cacheDrops,
         timings: this.timings,
         modules: getGroupedModules(this.modules),
         changedModules: this.changedModules
      };
   }
}

let instance;

function getMetricsReporter() {
   if (!instance) {
      instance = new MetricsReporter();
   }

   return instance;
}

module.exports = getMetricsReporter;

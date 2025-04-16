'use strict';

const fs = require('fs-extra');
const { path } = require('../../../lib/platform/path');
const PENDING = 'PENDING';
const PASSED = 'PASSED';
const FAILED = 'FAILED';

function initModules(modulesInfo) {
   const modules = new Map();

   if (!Array.isArray(modulesInfo)) {
      return modules;
   }

   for (let index = 0; index < modulesInfo.length; ++index) {
      const moduleName = modulesInfo[index].name;

      modules.set(moduleName, PENDING);
   }

   return modules;
}

class BuildStatus {
   constructor() {
      this.modules = new Map();
      this.cacheIsDropped = false;
   }

   get report() {
      const report = {
         modules: { },
         cacheIsDropped: this.cacheIsDropped
      };

      this._finalize();

      for (const [moduleName, buildStatus] of this.modules.entries()) {
         report.modules[moduleName] = buildStatus;
      }

      return report;
   }

   init(modulesInfo) {
      this.modules = initModules(modulesInfo);

      return this;
   }

   save(directories, exitCode) {
      const report = {
         modules: { },
         cacheIsDropped: this.cacheIsDropped,
         exitCode
      };

      this._finalize();

      for (const [moduleName, buildStatus] of this.modules.entries()) {
         report.modules[moduleName] = buildStatus;
      }

      /**
       * modules_stats needs to be saved in 2 directories:
       * 1) cache folder is for builder to get proper state for last build
       * in situations when 2 builds are from different branches with different
       * logs locations
       * 2) log folder is for correct storage of modules_stats in build artifacts
       * and for further processing in wasaby-cli
       */
      directories.forEach((currentDirectory) => {
         const reportFilePath = path.join(currentDirectory, 'modules_stats.json');
         fs.outputJsonSync(reportFilePath, report);
      });
   }

   registerFailedModule(moduleInfo) {
      this.modules.set(moduleInfo.name, FAILED);
   }

   closePendingModules() {
      for (const [moduleName, buildStatus] of this.modules.entries()) {
         if (buildStatus === PENDING) {
            this.modules.set(moduleName, PASSED);
         }
      }
   }

   _finalize() {
      for (const [moduleName, buildStatus] of this.modules.entries()) {
         if (buildStatus === PENDING) {
            this.modules.set(moduleName, FAILED);
         }
      }
   }
}

let instance;

function getBuildStatusStorage(reset) {
   if (!instance || reset) {
      instance = new BuildStatus();
   }

   return instance;
}

module.exports = getBuildStatusStorage;

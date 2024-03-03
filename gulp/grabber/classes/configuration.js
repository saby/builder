/**
 * @author Kolbeshin F.A.
 */

'use strict';

const ModuleInfo = require('../../common/classes/base-module-info');
const BaseConfiguration = require('../../common/classes/base-configuration');
const { getProcessParameters } = require('../../common/configuration-reader');
const { getTsConfigPath, getCompilerOptions } = require('../../../lib/config-helpers');
const path = require('path');

/**
 * Класс с данными о конфигурации сборки
 */
class GrabberConfiguration extends BaseConfiguration {
   constructor() {
      super();

      // builder grabber task requires initialized core
      this.needTemplates = true;
   }

   loadSync(argv) {
      const { config } = getProcessParameters(argv);
      super.readConfigFile(config);

      const startErrorMessage = `Configuration file ${this.configFile} isn't valid.`;
      if (!this.outputPath.endsWith('.json')) {
         throw new Error(`${startErrorMessage} Параметр output должен быть json-файлом.`);
      }

      for (const module of this.rawConfig.modules) {
         const moduleInfo = new ModuleInfo(module);
         moduleInfo.output = path.join(this.cachePath, moduleInfo.name);
         moduleInfo.symlinkInputPathToAvoidProblems(this.cachePath, true);

         this.modules.push(moduleInfo);
      }

      this.sourcesDirectory = path.join(this.cachePath, 'temp-modules');
      this.tsconfig = getTsConfigPath();
      this.tsCompilerOptions = getCompilerOptions(this.tsconfig);
   }
}

module.exports = GrabberConfiguration;

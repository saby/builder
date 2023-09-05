'use strict';

const { cwd } = require('../../../lib/platform/path');
const { readConfigFileSync } = require('../configuration-reader');

class BaseConfiguration {
   constructor() {
      // path to the configuration file
      this.configFile = '';

      // ordinary configuration data to be used in changes store for getting a solution about builder cache reset.
      this.rawConfig = {};

      // objects list of full information about every single interface module of the building project
      this.modules = [];

      // logs output directory
      this.logFolder = '';

      // path to the folder of builder cache
      this.cachePath = '';

      // path to the folder of the build results.
      this.outputPath = '';

      // list of supported locales
      this.localizations = [];

      // list of hooks
      this.hooks = {};
   }

   readConfigFile(configFile) {
      this.configFile = configFile;
      this.rawConfig = readConfigFileSync(this.configFile, cwd());

      this.setConfigDirectories();
   }

   setConfigDirectories() {
      const startErrorMessage = `Configuration file ${this.configFile} isn't valid.`;

      if (!this.rawConfig.cache) {
         throw new Error(`${startErrorMessage} Не задан обязательный параметр cache`);
      }
      this.cachePath = this.rawConfig.cache;

      if (!this.rawConfig.output) {
         throw new Error(`${startErrorMessage} Не задан обязательный параметр output`);
      }

      // При сборке патча конечной директорией указывается converted_static_patch вместо
      // converted_static. Чтобы не пересобирать определённый список модулей для патча с нуля
      // и складывать их в директорию для патча, будем собирать весь проект целиком через механизм
      // changedFiles и в самом конце нужный список модулей для патча просто складывать в директорию
      // для результатов сборки патча.
      // По умолчанию мы указываем changedFilesOutput как output и из output удаляем постфикс _patch,
      // но мы также предоставим возможность указать директорию для результатов сборки патча
      // TODO удалить этот костыль по завершении задачи
      //  https://online.sbis.ru/opendoc.html?guid=f0f49c03-b7ba-4272-9a26-1a6ece8c1b2d&client=3
      //  когда научим jinnee передавать в билдер директорию для сборки патчей
      const hasModulesForPatch = this.rawConfig.modules.find(moduleInfo => !!moduleInfo.rebuild);
      const patchRegex = /(_|-)patch/;
      if (
         !!hasModulesForPatch &&
         !this.rawConfig.changedFilesOutput &&
         patchRegex.test(this.rawConfig.output)
      ) {
         this.rawConfig.changedFilesOutput = this.rawConfig.output;
         this.rawConfig.output = this.rawConfig.output.replace(patchRegex, '');
      }

      this.outputPath = this.rawConfig.output;

      if (this.rawConfig.hasOwnProperty('logs')) {
         this.logFolder = this.rawConfig.logs;

         /**
          * set Logfolder into gulp process environment to save logger report
          * properly, even for unexpected gulp tasks errors. Exception - fatal process
          * errors(f.e. OOM), that aborts current process and kills any availability of
          * saving some additional info about just happened
          */
         process.env.logFolder = this.rawConfig.logs;
         process.env.cacheFolder = this.rawConfig.cache;
      }
   }

   get initCore() {
      /**
       * Typescript compiling and afterward initializing of platform core is needed by builder
       * in this cases:
       * 1) build of templates is enabled.
       * 2) This is builder unit tests execution.
       * 3) localization was enabled for current project.
       */
      return this.needTemplates || this.builderTests || this.localizations.length > 0;
   }
}

module.exports = BaseConfiguration;

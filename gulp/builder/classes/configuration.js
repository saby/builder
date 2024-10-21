/* eslint-disable no-sync */

/**
 * @author Kolbeshin F.A.
 */

'use strict';

const { path } = require('../../../lib/platform/path');
const fs = require('fs-extra');
const ConfigurationReader = require('../../common/configuration-reader');
const { configureModuleChangedFiles } = require('../../../lib/changed-files/configuration');
const ModuleInfo = require('./module-info');
const {
   getLanguageByLocale,
   checkForSourcesOutput,
   parseThemesFlag,
   getTsConfigPath,
   getCompilerOptions
} = require('../../../lib/config-helpers');
const { calcHash } = require('../../../lib/helpers');
const availableLanguage = require('../../../resources/availableLanguage.json');
const BaseConfiguration = require('../../common/classes/base-configuration');
const logger = require('../../../lib/logger').logger();
const hooks = require('../../common/classes/hooks').hooks();
const getMetricsReporter = require('../../common/classes/metrics-reporter');
const ONLINE_REGEX = /^online(-|_).+/;

// Builder needs "View",  "UI", "UICore", "UICommon" and "Compiler"
// interface modules for template's build plugin.
const REQUIRED_TEMPLATE_MODULES = ['View', 'UICore', 'UI', 'Compiler', 'UICommon'];

// Typescript cache directory name
const TSC_CACHE_DIR = 'typescript-cache';

function getProvidedMeta(fullName) {
   const nameParts = fullName.split('/');

   return [nameParts.shift(), nameParts.join('/')];
}

function getAutoprefixerValue(autoprefixer, defaultValue) {
   switch (typeof autoprefixer) {
      case 'boolean':
         return autoprefixer;

      case 'object':
         if (!(autoprefixer instanceof Array)) {
            return autoprefixer;
         }
         return defaultValue;

      default:
         return defaultValue;
   }
}

/**
 * Class with data about configuration of the build.
 * @class BuildConfiguration
 * @public
 */
class BuildConfiguration extends BaseConfiguration {
   constructor() {
      super();

      // a sign whether or not gulp_config should be checked. Check it by default.
      this.checkConfig = true;

      // list of files and directories that builder will remove during current build.
      this.garbage = new Set();

      // compiled content version
      this.version = '';

      // modules for patch - when we need to rebuild part of project modules instead of full rebuild.
      this.modulesForPatch = [];

      // modules for which custom pack is always enabled despite files changes(needed for proper Superbundles
      // processing)
      this.modulesWithStrictCustomPack = [];

      // put built files directly to output instead of incremental one in cache
      this.outputIsCache = false;

      // copy sources to output directory
      this.sources = true;

      // make symlinks for source files
      this.symlinks = true;

      // TODO: Флаг необходим только для миграции кеша. Подумать о лучшей организации кеша в задаче:
      //    https://online.sbis.ru/opendoc.html?guid=948e03fc-c2af-4e22-ba70-d662cd5f7d84&client=3
      this.clearOutput = true;

      // default locale
      this.defaultLocalization = '';

      // replace some variables in static html pages in case of project not to be multi-service
      this.multiService = false;

      // Current service relative url
      this.urlServicePath = '';

      // BL service relative url. Using by desktop-application to set a specific location for theirs BL-service.
      // F.e. retail-offline has "/RetailOffline/" as catalog for BL-service, but desktop applications have "/" for UI.
      this.urlDefaultServicePath = '';

      // run typescript compilation
      this.typescript = false;

      // enable tsc compiler with "noEmit" flag(compile without saving - for errors check)
      this.tsc = false;

      // enables incremental tsc checker
      this.tscCache = true;

      // run less compilation
      this.less = false;

      // enable autoprefixer postprocessor in less compiler
      this.autoprefixer = true;

      // build common meta information for Presentation Service
      this.presentationServiceMeta = false;

      // generate "contents" for application's work
      this.contents = false;

      // build dynamic templates (*.wml, *tmpl).
      this.wml = false;

      // build static html pages based on Vdom/WS4 (*.html.tmpl)
      this.htmlWml = false;

      // build old xml-type dynamic templates (*.xhtml). Option is deprecated.
      this.deprecatedXhtml = false;

      // build static html pages based on component's Webpage options. Option is deprecated.
      this.deprecatedWebPageTemplates = false;

      // pack component's own dependencies. Option is deprecated.
      this.deprecatedOwnDependencies = false;

      // pack static html entry points to static packages.
      this.deprecatedStaticHtml = false;

      // minify sources and compiled modules
      this.minimize = false;

      // generate packages based on custom developer's configuration
      this.customPack = false;

      // same as customPack but with debug sources to be packed
      this.debugCustomPack = false;

      // generate project dependencies tree meta
      this.dependenciesGraph = false;

      // compress sources to gzip and brotli formats
      this.compress = false;

      // join module's meta files into common root meta file
      this.joinedMeta = false;

      // paste "resources" prefix to links
      this.resourcesUrl = true;

      // inline scripts in static html pages. If flag takes value of false, replace those scripts to
      // separated javascript files, which will be containing the content of sliced inline script.
      // Otherwise return html page content as is.
      this.inlineScripts = true;

      // use hash by content instead of file timestamp.
      this.hashByContent = true;

      // address of static server that is listening for changes from builder
      // side to update those on a server side.
      this.staticServer = false;

      // A sign of type of building project. Needed to choose whether or not project should use
      // additional cache folder as a storage of all of built files. If it's used, files will be
      // written into cache folder first, and only after that they will be copied into output folder.
      // Otherwise compiled files will be instantaneously written into output folder without any
      // additional cache storages. It's useful for large projects(as inside_all, with approximately
      // 500 interface modules) where copying of files is heavy task that sometimes longs within
      // unacceptable 5-25 minutes(common issue on Windows OS due to its file system)
      this.distributive = true;

      /**
       * If themes flag is true, all of themes interface modules will be built.
       * If themes flag is an array of several themes with/without modificator, build only those.
       * Default value is true
       * @type {boolean}
       */
      this.themes = true;

      // enable sourcemaps for minified resources
      this.sourceMaps = false;

      // output type of compiling file. Expected: umd/amd. "amd" by default
      this.moduleType = 'amd';

      // sign of desktop application. false by default
      this.desktop = false;

      // compile all modules at once before build.
      this.emitTypescript = false;

      // modules selected for rebuild
      this.selectedModules = [];

      // country for which is this build. RU by default
      this.countries = ['RU'];

      // current application language. ru by default
      this.langs = ['ru'];

      // enable debug react
      this.debugReactPS = false;

      this.jsonToLess = false;

      // enable metatypes generator
      this.metatypes = true;

      // create tsc reports
      this.tscReport = false;
   }

   get tscModulesHash() {
      let modulesList = this.modules;

      if (this.excludeModulesList) {
         modulesList = this.modules.filter(moduleInfo => !this.excludeModulesList.includes(moduleInfo.name));
      }

      // у project references свой список модулей, для которого должен быть сгенерирован
      // отдельный хеш и отдельная директория с результатами компиляции
      if (this.projectReferencesList) {
         modulesList = this.modules.filter(moduleInfo => this.projectReferencesList.includes(moduleInfo.name));
      }

      return calcHash(
         JSON.stringify(modulesList.map(m => m.path).sort()),
         'hex'
      );
   }

   get tscCacheLockFile() {
      return path.join(
         this.tscCacheRootPath,
         `${this.tscModulesHash}.lockfile`
      );
   }

   get tscCacheFeatureFile() {
      return path.join(
         this.tscCacheRootPath,
         `${this.tscModulesHash}.feature`
      );
   }

   get tscCachePath() {
      return path.join(
         this.tscCacheRootPath,
         this.tscModulesHash,
         this.tscModulesHash
      );
   }

   setExcludeModulesList(excludeModulesList) {
      this.excludeModulesList = excludeModulesList;
   }

   setProjectReferencesList(projectReferencesList) {
      this.projectReferencesList = projectReferencesList;
   }

   deleteProjectReferencesList() {
      delete this.projectReferencesList;
   }

   get typescriptOutputDir() {
      return path.join(
         path.dirname(this.tscCachePath),
         'emit'
      );
   }

   // tsc cache should be saved outside of
   // common builder cache because this cache
   // is generated by third-party library and
   // could be reused even when builder has
   // incompatible changes
   get tscCacheRootPath() {
      return path.join(this.cachePath, TSC_CACHE_DIR);
   }

   removeFromDeletedFiles(filePath) {
      const currentFileIndex = this.deletedFiles.indexOf(filePath);

      if (currentFileIndex !== -1) {
         this.deletedFiles.splice(currentFileIndex, 1);
      }
   }

   // returns modules list for patch. Needed to copy patch artifacts into specific folder
   getModulesForPatch() {
      if (
         !this.useCompiledModules &&
         fs.pathExistsSync(path.join(this.cachePath, 'builder-info.json'))
      ) {
         return this.modulesForPatch;
      }

      return [];
   }

   getModuleInfoByName(relativePath) {
      return this.modules.find(module => module.name === relativePath.split('/').shift());
   }

   getInterfaceByProvider(provider) {
      return this.interfaces.provided[provider];
   }

   generateConfig(watcherChangedFiles) {
      // WARNING: The order of executing _configure* functions is important!
      //  Do not change the order!

      const flagsList = this._configureBuildFlags();

      this._configureDistributiveInfo();
      this._configureBuildOptions();
      this._configureLocalizations();

      this.sourcesDirectory = path.join(this.cachePath, 'temp-modules');
      this.tscDirectory = path.join(this.cachePath, 'typescript-sources');

      // включаем по умолчанию компиляцию ts-кода через tsc везде, кроме тех
      // юнит-тестов билдера, где в конфигурации сборки emitTypescript не указан
      // UPD пока делаем это в рамках юнит тестов, глобально включим tsc после
      // выполнения работ по массовому удалению amd-module name директив по задаче
      // https://online.sbis.ru/opendoc.html?guid=941af2d1-584f-49b1-8d84-0eda5f9a07f5&client=3
      // tsc не включаем пока на локальном стенде, поскольку в докере tsc выжирает всю доступную память на
      // тачках разработчиков и докер умирает.
      if (this.rawConfig.hasOwnProperty('builderTests')) {
         this.builderTests = this.rawConfig.builderTests;

         this.emitTypescript = !!this.rawConfig.emitTypescript && this.rawConfig.tsc;
      } else {
         this.emitTypescript = !this.localStand;
      }

      this._installWatcherChangedFiles(watcherChangedFiles);
      this._configureModules(flagsList);

      this._configureInterfacesMeta();
   }

   /**
    * Configuration loading with using of the utility executing args. Synchronous loading
    * is the only option here because of common build workflow generating afterwards.
    * @param {string[]} argv utility running cli arguments
    * @param {object?} watcherChangedFiles Collection of changes received from watcher.
    */
   loadSync(argv, watcherChangedFiles) {
      const { config } = ConfigurationReader.getProcessParameters(argv);
      super.readConfigFile(config);

      this.generateConfig(watcherChangedFiles);

      getMetricsReporter().applyConfiguration(this);
      getMetricsReporter().save(this.logFolder);
   }

   addIntoGarbage(currentPath) {
      this.garbage.add(currentPath);
   }

   getGarbageList() {
      return [...this.garbage];
   }

   getFullModuleChangedFilesList(moduleName) {
      if (!this.changedFilesWithDependencies) {
         return null;
      }
      return this.changedFilesWithDependencies[moduleName] || null;
   }

   setFullModuleChangedFilesList(moduleName, changedFilesList) {
      this.changedFilesWithDependencies[moduleName] = changedFilesList;
   }

   isFacade(interfaceName) {
      return this.interfaces.required.includes(interfaceName);
   }

   // Configuring all common flags for Builder plugins
   _configureBuildFlags() {
      const flagsList = [];

      const shouldAddOption = option => (
         this.rawConfig.hasOwnProperty(option) && (
            typeof this.rawConfig[option] === 'boolean' ||
            typeof this.rawConfig[option] === 'string' ||
            typeof this.rawConfig[option] === 'number'
         )
      );

      // write all bool and string parameters of read config. Builder will use only known flags.
      Object.keys(this.rawConfig).forEach((currentOption) => {
         if (shouldAddOption(currentOption)) {
            this[currentOption] = this.rawConfig[currentOption];
            flagsList.push(currentOption);
         }
      });

      // autoprefixer option - input value can be boolean or object
      if (this.rawConfig.hasOwnProperty('autoprefixer')) {
         this.autoprefixer = getAutoprefixerValue(this.rawConfig.autoprefixer, this.autoprefixer);
         flagsList.push('autoprefixer');
      }

      // parse themes from config and use it to build theme interface modules
      if (this.rawConfig.hasOwnProperty('themes') && this.rawConfig.themes instanceof Array) {
         this.themes = parseThemesFlag(this.rawConfig.themes);
         flagsList.push('themes');
      }

      this.iconSizes = this.rawConfig.iconSizes;

      if (this.rawConfig.langs) {
         this.langs = this.rawConfig.langs;
      }

      if (this.rawConfig.countries) {
         this.countries = this.rawConfig.countries;
      }

      this.selectedModules = this.rawConfig.selectedModules;
      hooks.init(this.rawConfig.hooksPath);

      return flagsList;
   }

   /**
    * returns build mode in depend on
    * given Gulp configuration's flags
    * @returns {string}
    */
   _getBuildMode() {
      const packingEnabled = (
         this.deprecatedOwnDependencies ||
         this.deprecatedStaticHtml ||
         this.customPack ||
         this.debugCustomPack
      );

      // if we are getting packing task as input, minimization should be enabled
      if (packingEnabled && !this.minimize) {
         this.minimize = true;
      }

      return this.minimize || packingEnabled ? 'release' : 'debug';
   }

   _installWatcherChangedFiles(watcherChangedFiles) {
      if (typeof watcherChangedFiles === 'undefined') {
         return;
      }

      try {
         for (const module of this.rawConfig.modules) {
            if (watcherChangedFiles[module.name]) {
               module.changedFiles = watcherChangedFiles[module.name].changedFiles;
               module.deletedFiles = watcherChangedFiles[module.name].deletedFiles;
            }
         }

         this.watcherRunning = true;
         this.emitTypescript = false;
      } catch (error) {
         logger.warning(`Could not read changed files from watcher: ${error.message}`);
      }
   }

   _configureModules(flagsList) {
      const mainModulesForTemplates = [];

      this.interfaces = {
         providedOrder: [],
         provided: { },
         required: [],
         depends: { },
         defaultProvider: { }
      };

      this.changedFilesWithDependencies = {};
      this.deletedFiles = [];
      this.modulesWithEmptyChangedFiles = 0;
      this.typescriptChanged = false;
      this.jsChanged = false;

      this.templatesProcessorHash = {};
      this.moduleInfoMap = {};

      if (this.rawConfig.externalModules instanceof Array) {
         this.externalModules = this.rawConfig.externalModules;
      }

      for (const module of this.rawConfig.modules) {
         const moduleInfo = new ModuleInfo(
            module,
            this.countries,
            {
               output: this.outputPath,
               changedFilesOutput: this.changedFilesOutput || ''
            },
            this.staticServer
         );
         if (!this.useCompiledModules && moduleInfo.compiled) {
            this.useCompiledModules = true;
         }

         this._configureModuleProperties(moduleInfo, module, flagsList);

         if (moduleInfo.rebuild) {
            this.modulesForPatch.push(moduleInfo);
         }
         if (REQUIRED_TEMPLATE_MODULES.includes(moduleInfo.name)) {
            mainModulesForTemplates.push(moduleInfo.name);
         }

         if (moduleInfo.depends && moduleInfo.depends.length > 0) {
            this.interfaces.depends[moduleInfo.outputName] = moduleInfo.depends;
            moduleInfo.fullDependsTree = this.recursiveGetModuleDependencies(
               moduleInfo,
               [moduleInfo.name]
            );
         }

         // if compiled flag was transmitted as 'false' we should run additional check
         // in this case.
         if (typeof moduleInfo.compiled === 'boolean' && !moduleInfo.compiled) {
            this._configureCompiledModule(moduleInfo);
         }

         this._configureModuleFeatures(moduleInfo);
         this._configureModuleChangedFiles(moduleInfo, module);

         // создаём мапу по модулям, чтобы получать к любому модулю быстрый доступ при выполнении
         // трудоёмких задач рекурсивного анализа наличия изменений
         this.moduleInfoMap[moduleInfo.name] = moduleInfo;

         switch (moduleInfo.name) {
            case 'ThemesModule':
               this.themesModuleInfo = moduleInfo;
               this.modules.push(moduleInfo);
               break;

            case 'Controls':
               // !! ВРЕМЕННОЕ РЕШЕНИЕ ДЛЯ 3100
               // на текущий момент модуль Controls по внешним зависимостям зависит от Controls-default-theme
               // (из-за css variables)
               // но билдер не может добавить его в link_dependencies, поскольку это требует наличия зависимости
               // в s3mod в секции depends, а она туда сейчас не может быть добавлена из за циклической
               // зависимости (Controls-default-theme уже явно зависит от Controls)
               // поэтому временно добавляем зависимость руками в билдере, чтобы обеспечить правильную подстановку
               // хеша модуля Controls-default-theme в Controls и Superbundles(куда этот модуль упаковывается)
               // TODO доработать link_dependencies, чтобы туда мог сохраняться модуль, даже если он не указан в
               //   секции depends https://online.sbis.ru/opendoc.html?guid=b799dc1a-8128-4322-9b57-8a61f01688f7&client=3
               moduleInfo.depends.push('Controls-default-theme');
               this.modules.push(moduleInfo);
               break;

            case 'Superbundles':
               moduleInfo.depends.push('Controls-default-theme');
               if (moduleInfo.depends instanceof Array) {
                  this.modulesWithStrictCustomPack = ['Superbundles', ...moduleInfo.depends];
               }
               this.modules.push(moduleInfo);
               break;

            case 'Compiler':
            case 'View':
            case 'UI':
               if (moduleInfo.hash) {
                  this.templatesProcessorHash[moduleInfo.name] = moduleInfo.hash;
               }
               this.modules.push(moduleInfo);
               break;

            default:
               this.modules.push(moduleInfo);
               break;
         }
      }

      // templates can be built only if there is a whole pack of required interface modules
      // for templates build
      if (mainModulesForTemplates.length === REQUIRED_TEMPLATE_MODULES.length) {
         this.templateBuilder = true;
      }

      this.projectWithoutChangesInFiles = this.rawConfig.modules.length === this.modulesWithEmptyChangedFiles;
   }

   /**
    * get full dependencies tree recursively for given interface module.
    * @param{ModuleInfo} moduleInfo current module info
    * @param{Array} currentDepTree - current dependency chain to detect and break cycles
    * @returns {*[]}
    */
   recursiveGetModuleDependencies(moduleInfo, currentDepTree) {
      const currentModuleDependencies = moduleInfo.depends;

      const resultDependencies = currentModuleDependencies.map((currentDependency) => {
         const currentModuleInfo = this.modules.find(module => module.name === currentDependency);

         if (!currentModuleInfo) {
            return currentDependency;
         }

         // break cycle dependencies
         if (currentDepTree.includes(currentDependency)) {
            return currentDependency;
         }

         // return full dependencies tree for already processed modules.
         if (currentModuleInfo.fullDependsTree.length > 0) {
            return currentModuleInfo.fullDependsTree;
         }

         if (currentModuleInfo.depends.length > 0) {
            return this.recursiveGetModuleDependencies(currentModuleInfo, [...currentDepTree, currentDependency]);
         }

         return currentDependency;
      }).concat(moduleInfo.depends);

      // remove duplicates
      return [...new Set([...resultDependencies.flat()])];
   }

   isWmlPluginEnabled(moduleInfo) {
      return (
         (
            !!moduleInfo.wml &&
            !moduleInfo.isUnitTestModule &&
            this.isReleaseMode
         ) || this.generateUMD
      );
   }

   isDependenciesEnabled(moduleInfo) {
      // there is no need in module-dependencies meta in debug mode. It's only needed by templates that
      // delivers now "as is" and doesn't compile in debug mode. Thus, module-dependencies meta now can be
      // disabled in debug mode too. Also enable it in builder unit test to check if it's properly working.
      return (
         !this.watcherRunning &&
         (this.isReleaseMode || moduleInfo.builderTests) &&
         (
            moduleInfo.dependenciesGraph ||
            moduleInfo.customPack ||
            moduleInfo.deprecatedStaticHtml ||
            moduleInfo.checkModuleDependencies
         )
      );
   }

   _configureDistributiveInfo() {
      // version есть только при сборке дистрибутива
      if (this.rawConfig.hasOwnProperty('version') && typeof this.rawConfig.version === 'string') {
         this.version = this.rawConfig.version;
      }

      // For now, distinguish local stand and distributive builds by containing of ".genie" folder
      // in cache path.
      // TODO use a special flag instead of this code below after task completion
      // https://online.sbis.ru/opendoc.html?guid=ae4cbd50-74bd-49ba-bffa-e49f15a954e8
      // Also we can't use lite build mode in case where source files should be removed from output directory
      // because there are configs of custom packages to be used in further rebuilds.
      this.localStand = this.cachePath.includes('.genie') && this.sources;

      this.cloud = this.cld_name || '';
      this.responsibleOfCloud = this.cld_responsible;

      // в тестах деплоя джина происходит сравнение лоб в лоб эталонного результата сборки и тестового.
      // Библиотека svgtofont в её текущей ревизии генерирует шрифты и стили по timestamp и при каждой
      // сборке шрифты генерятся с отличиями, хотя по содержанию и набору иконок они абсолютно идентичны
      // И данная библиотека, к большому сожалению, не содержит никакого API для отключения данной опции.
      // Поэтому пока не генерим шрифты в данной тестовой сборке.
      if (this.cloud === 'test-deploy') {
         this.disableFontsGenerate = true;
      }

      if (ONLINE_REGEX.test(this.cloud)) {
         this.isOnlineInside = true;
      }

      this.isAdminSbisRu = this.cloud.endsWith('admin.sbis.ru');

      if (this.rawConfig['url-default-service-path']) {
         this.urlDefaultServicePath = this.rawConfig['url-default-service-path'];
      } else {
         this.urlDefaultServicePath = this.urlServicePath || '/';
      }

      if (this.rawConfig.hasOwnProperty('multi-service')) {
         this.multiService = this.rawConfig['multi-service'];
      }
   }

   _configureBuildOptions() {
      // for 'umd' use ['amd', 'umd'] for templates processor to generate both
      // formats of code.
      if (this.rawConfig.hasOwnProperty('moduleType')) {
         const { moduleType } = this.rawConfig;
         if (typeof moduleType === 'string' && moduleType.toLowerCase() === 'umd') {
            this.moduleType = ['amd', 'umd'];
            this.generateUMD = true;
         }
      }

      this.isReleaseMode = this._getBuildMode() === 'release';

      if (this.rawConfig.hasOwnProperty('outputIsCache')) {
         this.outputIsCache = this.rawConfig.outputIsCache;
      } else {
         this.outputIsCache = this.sources;
      }

      if (this.outputIsCache) {
         this.outputPath = this.rawConfig.output;
      } else {
         // in desktop applications use modules cache, because we need to filter source files before writing in
         // output directory.
         this.outputPath = path.join(this.cachePath, 'incremental_build');
      }

      const isSourcesOutput = checkForSourcesOutput(this.rawConfig);
      if (isSourcesOutput) {
         this.isSourcesOutput = isSourcesOutput;
      }

      this.needTemplates = this.wml || this.htmlWml || this.deprecatedXhtml || this.generateUMD;

      this.branchTests = this.branchTests || this.lessCoverage || this.wsCoreMap;

      this.tsconfig = getTsConfigPath(this.rawConfig.tsconfig, this.configFile);
      this.tsCompilerOptions = getCompilerOptions(this.tsconfig);

      // FIXME: Вместо 2021 используем 2019. После завершения проекта, вернуть обратно
      //   https://online.sbis.ru/opendoc.html?guid=275e9e3b-1973-44a9-af21-f922019564fd&client=3
      if (this.ESVersion === 2021) {
         this.ESVersion = 2019;
      }
      if (!this.ESVersion) {
         this.ESVersion = 2019;
      }

      // set ESVersion parameter in global environment to set
      // default ecmaVersion parameter in espree parse function
      if (this.ESVersion) {
         this.tsCompilerOptions.target = `es${this.ESVersion}`;
         process.env.ESVersion = this.ESVersion;
      }

      if (this.compiled) {
         this.additionalCachePath = path.dirname(this.compiled);
      }

      if (this.rawConfig.hasOwnProperty('url-service-path')) {
         this.urlServicePath = this.rawConfig['url-service-path'];
      }

      // application name to be used in templates processor
      const isUiService = !this.urlServicePath.includes('/service/');

      // application name to be used in css links rebase and html pages
      this.applicationForRebase = isUiService ? this.urlServicePath || '/' : '/';

      if (this.joinedMeta) {
         this.commonContents = {};
      }

      if (this.debugReactPS) {
         this.reactMode = 'debug';
      }

      if (this.sources && this.ESVersion === 5) {
         this.buildIE = true;
      }
   }

   _configureLocalizations() {
      const startErrorMessage = `Configuration file ${this.configFile} isn't valid.`;

      // localization может быть списком или false
      const hasLocalizations = (
         this.rawConfig.hasOwnProperty('localization') &&
         !!this.rawConfig.localization
      );

      // default-localization может быть строкой или false
      const hasDefaultLocalization = (
         this.rawConfig.hasOwnProperty('default-localization') &&
         !!this.rawConfig['default-localization']
      );

      if (hasDefaultLocalization !== hasLocalizations) {
         throw new Error(`${startErrorMessage} default localization was specified, but there is no locales list in build config. Please, specify it.`);
      }

      if (!hasLocalizations) {
         return;
      }

      this.localizations = this.rawConfig.localization;

      const defaultLocalizationsToPush = new Set();
      for (const currentLocale of this.localizations) {
         if (!availableLanguage.hasOwnProperty(currentLocale)) {
            throw new Error(`${startErrorMessage} This locale is not permitted: ${currentLocale}`);
         }

         const commonLocale = currentLocale.split('-').shift();
         if (!availableLanguage.hasOwnProperty(currentLocale)) {
            throw new Error(`${startErrorMessage} This default localization is not permitted: ${currentLocale}`);
         }

         // There is nothing to do if default locale has already been declared
         if (commonLocale !== currentLocale) {
            defaultLocalizationsToPush.add(commonLocale);
         }

         if (!this.langs.includes(currentLocale)) {
            this.langs.push(currentLocale);
         }
      }

      // add common locales to locales list
      defaultLocalizationsToPush.forEach((locale) => {
         if (!this.localizations.includes(locale)) {
            this.localizations.push(locale);
         }
      });

      // build rtl styles for Israel and Arabic countries
      if (this.localizations.includes('ar') || this.localizations.includes('he')) {
         this.buildRtl = true;
      }

      this.defaultLocalization = this.rawConfig['default-localization'];

      if (!availableLanguage.hasOwnProperty(this.defaultLocalization)) {
         throw new Error(
            `${startErrorMessage} There is an incorrect identity of localization by default: ${
               this.defaultLocalization
            }`
         );
      }

      if (!this.localizations.includes(this.defaultLocalization)) {
         throw new Error(`${startErrorMessage} default locale isn't included into locales list`);
      }
   }

   // fills interfaces meta with information about dependencies from s3mod
   _configureInterfacesMeta() {
      Object.keys(this.interfaces.provided).forEach((currentKey) => {
         const [providedModuleName, featureName] = getProvidedMeta(currentKey);
         const providedModuleDepends = this.interfaces.depends[providedModuleName] || [];

         // interface could be a provider by itself.
         if (this.isFacade(currentKey)) {
            this.interfaces.provided[currentKey] = currentKey;
         }

         providedModuleDepends.forEach((currentDependency) => {
            const currentBaseModuleName = `${currentDependency}/${featureName}`;

            if (this.isFacade(currentBaseModuleName)) {
               this.interfaces.provided[currentKey] = currentBaseModuleName;
            }
         });
      });
   }

   _configureModuleProperties(moduleInfo, module, flagsList) {
      if (!this.disableSourcesPrepare) {
         moduleInfo.symlinkInputPathToAvoidProblems(this.cachePath, true, this.watcherRunning);
      }

      moduleInfo.isUnitTestModule = this.branchTests && (
         moduleInfo.isUnitTestModule ||

         // cdn module is a bunch of third-party libraries, so it can't be parsed
         // and should be only transmitted to output directory.
         module.name === 'cdn'
      );
      moduleInfo.contents.buildMode = this._getBuildMode();

      if (this.defaultLocalization && this.localizations.length > 0) {
         moduleInfo.contents.defaultLanguage = this.defaultLocalization;
         moduleInfo.contents.availableLanguage = { };

         for (const local of this.localizations) {
            moduleInfo.contents.availableLanguage[local] = getLanguageByLocale(local);
         }
      }

      if (moduleInfo.name === 'HotReload' && this.staticServer) {
         moduleInfo.staticServer = this.staticServer;
      }

      flagsList.forEach((flag) => {
         if (module.hasOwnProperty(flag)) {
            moduleInfo[flag] = module[flag];
            return;
         }

         if (!moduleInfo.hasOwnProperty(flag)) {
            moduleInfo[flag] = this[flag];
         }
      });
   }

   _configureCompiledModule(moduleInfo) {
      const compiledHashPath = path.join(
         this.compiled || moduleInfo.path,
         moduleInfo.outputName,
         '.builder/hash.json'
      );

      // module has not been compiled yet if hash.json meta not found
      if (fs.pathExistsSync(compiledHashPath)) {
         const compiledHash = fs.readJsonSync(compiledHashPath).sourcesHash;

         // Module is compiled and can be copied into output with 2 conditions:
         // 1) 'hash' transmitted through gulp_config is equal to 'hash' stored
         // in current module output meta
         // 2) current module is not selected as a module for rebuild in deploy
         // settings
         if (compiledHash === moduleInfo.hash && !this.selectedModules.includes(moduleInfo.id)) {
            if (!this.watcherRunning) {
               logger.debug(`"compiled" flag of module "${moduleInfo.outputName}" was changed from 'false' to 'true'`);
            }

            moduleInfo.compiled = true;
         }
      }
   }

   _configureModuleFeatures(moduleInfo) {
      const toInterfaceName = featureName => `${moduleInfo.outputName}/${featureName}`;

      if (moduleInfo.featuresRequired.length > 0) {
         moduleInfo.featuresRequired.forEach(
            requiredFeature => this.interfaces.required.push(toInterfaceName(requiredFeature))
         );
         moduleInfo.hasFacades = true;
      }

      if (moduleInfo.featuresProvided.length > 0) {
         moduleInfo.featuresProvided.forEach((providedFeature) => {
            const interfaceName = toInterfaceName(providedFeature);

            this.interfaces.provided[interfaceName] = null;
            this.interfaces.providedOrder.push(interfaceName);
         });
      }
   }

   _configureModuleChangedFiles(moduleInfo, module) {
      const changedFilesMeta = configureModuleChangedFiles(moduleInfo, module);
      Object.keys(changedFilesMeta).forEach((currentMeta) => {
         if (!this[currentMeta]) {
            this[currentMeta] = changedFilesMeta[currentMeta];
         }
         if (changedFilesMeta[currentMeta] instanceof Array) {
            this[currentMeta] = [...this[currentMeta], ...changedFilesMeta[currentMeta]];
         } else if (changedFilesMeta[currentMeta] instanceof Object) {
            this[currentMeta] = { ...this[currentMeta], ...changedFilesMeta[currentMeta] };
         }
      });
      if (changedFilesMeta.needToExecuteHook) {
         const reason = 'Кеш иконок сброшен, иконки есть в списке deletedFiles';
         getMetricsReporter().onCacheDrop('icons', reason);
         hooks.executeHook('dropCacheHook', ['icons', reason]);
         this.dropCacheForIcons = true;
      }
   }
}

module.exports = BuildConfiguration;

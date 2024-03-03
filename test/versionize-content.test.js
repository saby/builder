'use strict';

const { path, toPosix } = require('../lib/platform/path');
const initTest = require('./init-test');
const versionizeContent = require('../lib/versionize-content');
const fs = require('fs-extra');

const dirname = toPosix(__dirname);
const workspaceFolder = path.join(dirname, 'workspace');
const cacheFolder = path.join(workspaceFolder, 'cache');
const outputFolder = path.join(workspaceFolder, 'output');
const sourceFolder = path.join(workspaceFolder, 'source');
const configPath = path.join(workspaceFolder, 'config.json');
const ModuleInfo = require('../gulp/builder/classes/module-info');
const generateWorkflow = require('../gulp/builder/generate-workflow.js');
const {
   isRegularFile, linkPlatform, TIMEOUT_FOR_HEAVY_TASKS
} = require('./lib');
const { promiseWithTimeout, TimeoutError } = require('../lib/promise-with-timeout');
const clearWorkspace = function() {
   return fs.remove(workspaceFolder);
};
const prepareTest = async function(fixtureFolder) {
   await clearWorkspace();
   await fs.ensureDir(sourceFolder);
   await fs.copy(fixtureFolder, sourceFolder);
};

function toArray(currentSet) {
   return [...currentSet];
}

const runWorkflow = function() {
   return new Promise((resolve, reject) => {
      generateWorkflow([`--config="${configPath}"`])((error) => {
         if (error) {
            reject(error);
         } else {
            resolve();
         }
      });
   });
};

/**
 * properly finish test in builder main workflow was freezed by unexpected
 * critical errors from gulp plugins
 * @returns {Promise<void>}
 */
const runWorkflowWithTimeout = async function() {
   let result;
   try {
      // mac sometimes needs more than 60 seconds to build test project
      result = await promiseWithTimeout(runWorkflow(), TIMEOUT_FOR_HEAVY_TASKS);
   } catch (err) {
      result = err;
   }
   if (result instanceof TimeoutError) {
      true.should.equal(false);
   }
};

describe('versionize-content', () => {
   before(async() => {
      await initTest();
   });

   it('versionize style content', async() => {
      const currentModuleInfo = new ModuleInfo(
         {
            name: 'MyModule',
            responsible: 'some responsible',
            path: 'someRoot/MyModule',
            depends: ['SBIS3.CONTROLS'],
            fullDependsTree: ['SBIS3.CONTROLS']
         },
         null,
         { output: 'someCache' }
      );
      const moduleInfoWithSpace = new ModuleInfo(
         {
            name: 'MyModule with space',
            responsible: 'some responsible',
            path: 'someRoot/MyModule with space',
            depends: ['View', 'SBIS3.CONTROLS', 'WS3Page'],
            fullDependsTree: ['View', 'SBIS3.CONTROLS', 'WS3Page']
         },
         null,
         { output: 'someCache' }
      );
      const wscoreModuleInfo = new ModuleInfo(
         {
            name: 'WS.Core',
            responsible: 'some responsible',
            path: 'someRoot/WS.Core',
            depends: []
         },
         null,
         { output: 'someCache' }
      );

      let base = path.join(dirname, 'someRoot/MyModule');
      let filePath = path.join(dirname, 'someRoot/MyModule/namespace1/style.css');

      const checkVersionizeStyleResult = async(
         moduleInfo,
         skipLogs,
         contents,
         correctNewText,
         containsErrors,
         externalDeps,
         isVersioned
      ) => {
         const currentFile = {
            contents,
            base,
            path: filePath,
            pPath: filePath
         };
         const result = await versionizeContent.versionizeStyles(currentFile, moduleInfo, { skipLogs });
         result.errors.should.equal(containsErrors);
         toArray(result.externalDependencies).should.have.members(externalDeps);

         // check result text if we need to
         if (correctNewText) {
            result.newText.should.equal(correctNewText);
         }
         if (typeof isVersioned !== 'undefined') {
            // check if info about version is transmitted through file object
            currentFile.versioned.should.equal(isVersioned);
         }
      };

      await checkVersionizeStyleResult(
         currentModuleInfo,
         false,
         'background-image:url(/resources/SBIS3.CONTROLS/default-theme/img/ajax-loader-16x16-wheel.gif)',
         'background-image:url(/resources/SBIS3.CONTROLS/default-theme/img/ajax-loader-16x16-wheel.gif?x_module=%{MODULE_VERSION_STUB=MyModule})',
         false,
         [],
         true
      );

      // woff and woff2 should be resolved properly
      await checkVersionizeStyleResult(
         currentModuleInfo,
         false,
         'url(\'../default-theme/fonts/cbuc-icons/cbuc-icons.woff\')',
         'url(\'../default-theme/fonts/cbuc-icons/cbuc-icons.woff?x_module=%{MODULE_VERSION_STUB=MyModule}\')',
         false,
         [],
         true
      );

      // bad relative link should return versioned module, but with error
      await checkVersionizeStyleResult(
         currentModuleInfo,
         true,
         'url(\'../../../../default-theme/fonts/cbuc-icons/cbuc-icons.woff\')',
         null,
         true,
         [],
         true
      );

      // woff and woff2 should be resolved properly
      await checkVersionizeStyleResult(
         currentModuleInfo,
         true,
         'url(\'../../MyModule2/default-theme/fonts/cbuc-icons/cbuc-icons.woff\')',
         'url(\'../../MyModule2/default-theme/fonts/cbuc-icons/cbuc-icons.woff?x_module=%{MODULE_VERSION_STUB=MyModule2}\')',
         true,
         [],
         true
      );
      currentModuleInfo.depends = ['MyModule2'];
      currentModuleInfo.fullDependsTree = ['MyModule2'];
      await checkVersionizeStyleResult(
         currentModuleInfo,
         true,
         'url(\'../../MyModule2/default-theme/fonts/cbuc-icons/cbuc-icons.woff\')',
         'url(\'../../MyModule2/default-theme/fonts/cbuc-icons/cbuc-icons.woff?x_module=%{MODULE_VERSION_STUB=MyModule2}\')',
         false,
         ['MyModule2'],
         true
      );
      currentModuleInfo.depends = [];
      currentModuleInfo.fullDependsTree = [];

      // WS.Core styles should be ignored from dependencies check
      await checkVersionizeStyleResult(
         wscoreModuleInfo,
         true,
         'url(\'../../MyModule2/default-theme/fonts/cbuc-icons/cbuc-icons.woff\')',
         'url(\'../../MyModule2/default-theme/fonts/cbuc-icons/cbuc-icons.woff?x_module=%{MODULE_VERSION_STUB=MyModule2}\')',
         false,
         ['MyModule2'],
         true
      );

      await checkVersionizeStyleResult(
         currentModuleInfo,
         false,
         'url(\'fonts/TensorFont/1.0.3/TensorFont/TensorFont.eot?#iefix\')',
         'url(\'fonts/TensorFont/1.0.3/TensorFont/TensorFont.eot?x_module=%{MODULE_VERSION_STUB=MyModule}#iefix\')',
         false,
         [],
         true
      );

      await checkVersionizeStyleResult(
         currentModuleInfo,
         false,
         'url(\'fonts/TensorFont/1.0.3/TensorFont/TensorFont.eot?test123\')',
         'url(\'fonts/TensorFont/1.0.3/TensorFont/TensorFont.eot?x_module=%{MODULE_VERSION_STUB=MyModule}#test123\')',
         false,
         [],
         true
      );

      // check if cdn link is skipped
      const cdnData = 'src: url(\'/cdn/fonts/TensorFont/1.0.3/TensorFont/TensorFont.eot?#iefix\') format(\'embedded-opentype\')';
      await checkVersionizeStyleResult(
         currentModuleInfo,
         false,
         cdnData,
         cdnData,
         false,
         []
      );

      base = path.join(dirname, 'someRoot/MyModule with space');
      filePath = path.join(dirname, 'someRoot/MyModule with space/namespace1/style.css');
      await checkVersionizeStyleResult(
         moduleInfoWithSpace,
         false,
         'background: url(img/Point.png)',
         'background: url(img/Point.png?x_module=%{MODULE_VERSION_STUB=MyModule_with_space})',
         false,
         [],
         true
      );
   });

   it('versionize templates content', () => {
      const currentModuleInfo = new ModuleInfo(
         {
            name: 'MyModule',
            responsible: 'some responsible',
            path: 'someRoot/MyModule',
            depends: ['View', 'SBIS3.CONTROLS', 'WS3Page'],
            fullDependsTree: ['View', 'SBIS3.CONTROLS', 'WS3Page']
         },
         null,
         { output: 'someCache/MyModule' }
      );
      const wscoreModuleInfo = new ModuleInfo(
         {
            name: 'WS.Core',
            responsible: 'some responsible',
            path: 'someRoot/WS.Core',
            depends: []
         },
         null,
         { output: 'someCache' }
      );

      const base = path.join(dirname, 'someRoot/MyModule');
      const filePath = path.join(dirname, 'someRoot/MyModule/namespace1/template.tmpl');
      const versionedMinLink = 'src="{{ _options.resourceRoot }}View/Runner/Vdom/third-party/boomerang-1.568.0.min.js?x_module=%{MODULE_VERSION_STUB=View}">';

      const checkVersionizeTemplateResult = (
         moduleInfo,
         skipLogs,
         contents,
         correctNewText,
         containsErrors,
         externalDeps,
         isVersioned
      ) => {
         const currentFile = {
            contents,
            base,
            path: filePath
         };
         const result = versionizeContent.versionizeTemplates(currentFile, moduleInfo, skipLogs);
         result.errors.should.equal(containsErrors);
         toArray(result.externalDependencies).should.have.members(externalDeps);

         // check result text if we need to
         if (correctNewText) {
            result.newText.should.equal(correctNewText);
         }
         if (typeof isVersioned !== 'undefined') {
            // check if info about version is transmitted through file object
            currentFile.versioned.should.equal(isVersioned);
         }
      };

      let cdnSource = 'src="/cdn/jquery/3.3.1/jquery-min.js">';
      checkVersionizeTemplateResult(
         currentModuleInfo,
         false,
         cdnSource,
         cdnSource,
         false,
         []
      );

      cdnSource = '<link rel="preload" as="font" href="/cdn/fonts/TensorFont/1.0.3/TensorFontBold/TensorFontBold.woff2" type="font/woff2"/>';
      checkVersionizeTemplateResult(
         currentModuleInfo,
         false,
         cdnSource,
         cdnSource,
         false,
         []
      );

      // check if .min suffix isn't added several times
      checkVersionizeTemplateResult(
         currentModuleInfo,
         false,
         'src="{{ _options.resourceRoot }}View/Runner/Vdom/third-party/boomerang-1.568.0.min.js">',
         versionedMinLink,
         false,
         ['View']
      );

      checkVersionizeTemplateResult(
         currentModuleInfo,
         false,
         'src="{{item.get(image) || resourceRoot + \'SBIS3.CONTROLS/themes/online/img/defaultItem.png\'}}">',
         'src="{{item.get(image) || resourceRoot + \'SBIS3.CONTROLS/themes/online/img/defaultItem.png?x_module=%{MODULE_VERSION_STUB=SBIS3.CONTROLS}\'}}">',
         false,
         ['SBIS3.CONTROLS'],
         true
      );

      // check for correct module in both resourceRoot
      checkVersionizeTemplateResult(
         currentModuleInfo,
         false,
         'href="%{RESOURCE_ROOT}PrestoOrder/resources/font/Presto-icons.css"',
         'href="%{RESOURCE_ROOT}PrestoOrder/resources/font/Presto-icons.min.css?x_module=%{MODULE_VERSION_STUB=PrestoOrder}"',
         true,
         [],
         true
      );

      // WS.Core template should be ignored from dependencies check
      checkVersionizeTemplateResult(
         wscoreModuleInfo,
         false,
         'href="%{RESOURCE_ROOT}PrestoOrder/resources/font/Presto-icons.css"',
         'href="%{RESOURCE_ROOT}PrestoOrder/resources/font/Presto-icons.min.css?x_module=%{MODULE_VERSION_STUB=PrestoOrder}"',
         false,
         ['PrestoOrder'],
         true
      );

      checkVersionizeTemplateResult(
         wscoreModuleInfo,
         false,
         'href="%{APPLICATION_ROOT}resources/PrestoOrder/resources/font/Presto-icons.css"',
         'href="%{APPLICATION_ROOT}resources/PrestoOrder/resources/font/Presto-icons.min.css?x_module=%{MODULE_VERSION_STUB=PrestoOrder}"',
         false,
         ['PrestoOrder'],
         true
      );

      checkVersionizeTemplateResult(
         currentModuleInfo,
         false,
         '<link rel="stylesheet" href="demo-files/demo.css">',
         '<link rel="stylesheet" href="demo-files/demo.min.css?x_module=%{MODULE_VERSION_STUB=MyModule}">',
         false,
         [],
         true
      );

      checkVersionizeTemplateResult(
         currentModuleInfo,
         true,
         'src="/materials/resources/SBIS3.CONTROLS/themes/online/online.css"',
         'src="/materials/resources/SBIS3.CONTROLS/themes/online/online.min.css?x_module=%{MODULE_VERSION_STUB=SBIS3.CONTROLS}"',
         false,
         ['SBIS3.CONTROLS'],
         true
      );

      checkVersionizeTemplateResult(
         currentModuleInfo,
         true,
         'src="/previewer/95/resources/Applications/Card/images/default-image.png"',
         'src="/previewer/95/resources/Applications/Card/images/default-image.png?x_module=%{MODULE_VERSION_STUB=Applications}"',
         true,
         [],
         true
      );

      checkVersionizeTemplateResult(
         currentModuleInfo,
         true,
         'src="/previewer/resources/Applications/Card/images/default-image.png"',
         'src="/previewer/resources/Applications/Card/images/default-image.png?x_module=%{MODULE_VERSION_STUB=Applications}"',
         true,
         [],
         true
      );

      checkVersionizeTemplateResult(
         currentModuleInfo,
         false,
         'src="../build/pdf.min.js"',
         'src="../build/pdf.min.js?x_module=%{MODULE_VERSION_STUB=MyModule}"',
         false,
         [],
         true
      );

      // check if .min suffix is added when it is missing
      checkVersionizeTemplateResult(
         currentModuleInfo,
         false,
         'src="{{ _options.resourceRoot }}View/Runner/Vdom/third-party/boomerang-1.568.0.js">',
         versionedMinLink,
         false,
         ['View'],
         true
      );

      // check versioning of fonts
      checkVersionizeTemplateResult(
         currentModuleInfo,
         true,
         '<link href="{{resourceRoot}}Controls-default-theme/fonts/cbuc-icons/cbuc-icons.woff2"/>',
         '<link href="{{resourceRoot}}Controls-default-theme/fonts/cbuc-icons/cbuc-icons.woff2?x_module=%{MODULE_VERSION_STUB=Controls-default-theme}"/>',
         true,
         [],
         true
      );

      checkVersionizeTemplateResult(
         currentModuleInfo,
         false,
         '<link href="{{=it.resourceRoot}}WS3Page/Templates/css/graytheme.css"/>',
         '<link href="{{=it.resourceRoot}}WS3Page/Templates/css/graytheme.min.css?x_module=%{MODULE_VERSION_STUB=WS3Page}"/>',
         false,
         ['WS3Page'],
         true
      );

      // check if object properties are skipped and won't be versionized
      const testSpanFromTemplate = '<span class="edo-TaskCol-date-number-mark-dot icon-16 icon-{{item[\'colorMarkState\'].icon}}"';
      checkVersionizeTemplateResult(
         currentModuleInfo,
         false,
         testSpanFromTemplate,
         testSpanFromTemplate,
         false,
         []
      );

      // check an existence of "buildNumber" placeholder in "contents" url for multi-service application
      checkVersionizeTemplateResult(
         currentModuleInfo,
         false,
         'src="/materials/resources/contents.js"',
         'src="/materials/resources/contents.min.js"',
         false,
         [],
         true
      );
   });

   it('should versionize only compiled and minified files, except for css', async() => {
      const fixtureFolder = path.join(dirname, 'fixture/versionize-finish');
      await prepareTest(fixtureFolder);
      await linkPlatform(sourceFolder);
      const config = {

         // eslint-disable-next-line id-match
         cld_name: 'builder-tests',
         cache: cacheFolder,
         output: outputFolder,
         logs: path.join(workspaceFolder, 'logs'),
         wml: true,
         minimize: true,
         version: 'test',
         'multi-service': true,
         modules: [
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль')
            },
            {
               name: 'WS.Core',
               path: path.join(sourceFolder, 'WS.Core')
            },
            {
               name: 'View',
               path: path.join(sourceFolder, 'View')
            },
            {
               name: 'UI',
               path: path.join(sourceFolder, 'UI')
            },
            {
               name: 'Compiler',
               path: path.join(sourceFolder, 'Compiler')
            },
            {
               name: 'UICore',
               path: path.join(sourceFolder, 'UICore')
            },
            {
               name: 'UICommon',
               path: path.join(sourceFolder, 'UICommon')
            },
            {
               name: 'Vdom',
               path: path.join(sourceFolder, 'Vdom')
            },
            {
               name: 'Router',
               path: path.join(sourceFolder, 'Router')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      // запустим таску
      await runWorkflowWithTimeout();
      (await isRegularFile(outputFolder, 'Modul/Page.wml')).should.equal(true);
      (await isRegularFile(outputFolder, 'Modul/Page.min.wml')).should.equal(true);
      const templateSourceContent = (await fs.readFile(path.join(outputFolder, 'Modul/Page.wml'))).toString();
      const templateCompiledContent = (await fs.readFile(path.join(outputFolder, 'Modul/Page.min.wml'))).toString();

      // проверим, что в исходниках ссылки остались прежними, а в скомпилированном появилась версия и суффикс min
      const templateSourceNotChanged = templateSourceContent.includes('contents.js"') &&
         templateSourceContent.includes('require-min.js"') &&
         templateSourceContent.includes('bundles.js"') &&
         templateSourceContent.includes('src="{{item.get(image) ? item.get(image) : \'/resources/SBIS3.CONTROLS/themes/online/img/defaultFolder.png\'}}" />');
      templateSourceNotChanged.should.equal(true);
      const templateCompiledChanged = templateCompiledContent.includes('contents.min.js') &&
         templateCompiledContent.includes('config.min.js"') &&
         templateCompiledContent.includes('"/cdn/requirejs/2.3.5-p3/require-min.js"');
      templateCompiledChanged.should.equal(false);

      const styleSourceContent = (await fs.readFile(path.join(outputFolder, 'Modul/cbuc-icons.css'))).toString();
      const styleCompiledContent = (await fs.readFile(path.join(outputFolder, 'Modul/cbuc-icons.min.css'))).toString();

      // проверим, что в исходниках ссылки остались прежними, а в скомпилированном появилась версия и суффикс min
      const styleSourceIsChanged = styleSourceContent.includes("url('cbuc-icons/cbuc-icons.eot?x_module=%{MODULE_VERSION_STUB=Modul}#iefix')") &&
         styleSourceContent.includes("url('cbuc-icons/cbuc-icons.woff2?x_module=%{MODULE_VERSION_STUB=Modul}')");

      // source css file should be changed too, service of static won't get current
      // url from css without inserted version header
      styleSourceIsChanged.should.equal(true);
      const styleCompiledChanged = styleCompiledContent.includes("url('cbuc-icons/cbuc-icons.eot?x_module=%{MODULE_VERSION_STUB=Modul}#iefix')") &&
         styleCompiledContent.includes("url('cbuc-icons/cbuc-icons.woff2?x_module=%{MODULE_VERSION_STUB=Modul}')");
      styleCompiledChanged.should.equal(true);
      await clearWorkspace();
   });
});

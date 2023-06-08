'use strict';

const { path, toPosix } = require('../lib/platform/path');
const { expect } = require('chai');
const fs = require('fs-extra');
const {
   isRegularFile,
   TIMEOUT_FOR_HEAVY_TASKS
} = require('./lib');
const initTest = require('./init-test');
const {
   promiseWithTimeout,
   TimeoutError
} = require('../lib/promise-with-timeout');

const dirname = toPosix(__dirname);
const workspaceFolder = path.join(dirname, 'workspace');
const cacheFolder = path.join(workspaceFolder, 'cache');
const outputFolder = path.join(workspaceFolder, 'output');
const logsFolder = path.join(workspaceFolder, 'logs');
const sourceFolder = path.join(workspaceFolder, 'source');
const configPath = path.join(workspaceFolder, 'config.json');

const clearWorkspace = async function() {
   await fs.remove(`${workspaceFolder}-1`);
   return fs.remove(workspaceFolder);
};

const prepareTest = async function(fixtureFolder) {
   await clearWorkspace();
   await fs.ensureDir(sourceFolder);
   await fs.copy(fixtureFolder, sourceFolder);
};

const generateWorkflow = require('../gulp/builder/generate-workflow.js');
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

const { getIconSizeByViewBox } = require('../gulp/builder/plugins/process-svg');

/**
 * properly finish test in builder main workflow was freezed by unexpected
 * critical errors from gulp plugins
 * @returns {Promise<void>}
 */
const runWorkflowWithTimeout = async function(timeout) {
   let result;
   try {
      result = await promiseWithTimeout(runWorkflow(), timeout || TIMEOUT_FOR_HEAVY_TASKS);
   } catch (err) {
      result = err;
   }
   if (result instanceof TimeoutError) {
      true.should.equal(false);
   }
};

describe('process svg', () => {
   before(async() => {
      await initTest();
   });
   it('check common plugin', async() => {
      const fixtureFolder = path.join(dirname, 'fixture/builder-generate-workflow/process-svg');
      await prepareTest(fixtureFolder);

      const config = {
         cache: cacheFolder,
         output: outputFolder,
         logs: logsFolder,
         iconSizes: true,
         modules: [
            {
               name: 'Test-icons',
               path: path.join(sourceFolder, 'Test-icons')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      // запустим таску
      await runWorkflowWithTimeout();
      const iconsOutputFolder = path.join(outputFolder, 'Test-icons');

      const testResults = async(filteringPackageExists) => {
         // 'filtering' folder has svg icons matching allowed name pattern, so there should be a package
         // as a result
         (await isRegularFile(iconsOutputFolder, 'filtering_s.svg')).should.equal(filteringPackageExists);
         (await isRegularFile(iconsOutputFolder, 'filtering.svg')).should.equal(filteringPackageExists);

         // 'sorting' folder has none of any svg icon with a valid name, so builder should ignore them
         // and there should be a void as result of 'sorting' folder analyze
         (await isRegularFile(iconsOutputFolder, 'sorting_s.svg')).should.equal(false);
         (await isRegularFile(iconsOutputFolder, 'sorting.svg')).should.equal(false);


         (await isRegularFile(iconsOutputFolder, 'icons.json')).should.equal(true);

         // icon with viewBox 0 0 16 16 must be saved in output folder with correct size postfix
         (await isRegularFile(path.join(iconsOutputFolder, 'filtering'), 'icon-Test2.svg')).should.equal(false);
         (await isRegularFile(path.join(iconsOutputFolder, 'filtering_s'), 'icon-Test2.svg')).should.equal(filteringPackageExists);

         // anotherFilter/icon-AnotherTest has viewBox 0 0 28 16, so we can't determine exact size of this icon
         // and postfix won't be added in this case
         (await isRegularFile(path.join(iconsOutputFolder, 'anotherFilter'), 'icon-AnotherTest.svg')).should.equal(true);

         // width and height attributes should be removed from svg tag, viewBox should be calculated instead
         // also inner tags should have their dimensions on its places
         const dimensionsContent = await fs.readFile(path.join(iconsOutputFolder, 'icon-Dimensions.svg'), 'utf8');
         dimensionsContent.should.equal('<svg><polygon width="16" height="16"/></svg>');

         // width and height attributes should not be removed from svg tag if skip_clean attribute exists
         const dimensionsContentWithSkipClean = await fs.readFile(path.join(iconsOutputFolder, 'icon-Dimensions_skipclean.svg'), 'utf8');
         dimensionsContentWithSkipClean.should.equal('<svg width="16" height="16"><polygon width="16" height="16"/></svg>');

         // svg package should be without skip_clean tag and without any optimizations
         const filteringWithSkipCleanResult = await fs.readFile(path.join(iconsOutputFolder, 'filteringWithSkipClean.svg'), 'utf8');
         filteringWithSkipCleanResult.should.equal('<svg xmlns="http://www.w3.org/2000/svg"><svg><symbol id="icon-Test1" xml:space="preserve"><path class="st0" d="M21.00002"/></symbol></svg></svg>');

         // svg packer should do several things:
         // 1) remove all needless attributes, such as version, xmlns, style, fill
         // 2) change 'svg' tag of current svg icons to symbol
         // 3) set 'id' attribute as a name of current svg file
         // 4) write it inside common 'svg' tag of current svg package
         const iconsMeta = await fs.readJson(path.join(iconsOutputFolder, 'icons.json'));
         if (filteringPackageExists) {
            const filteringResult = await fs.readFile(path.join(iconsOutputFolder, 'filtering.svg'), 'utf8');
            filteringResult.should.equal(
               '<svg xmlns="http://www.w3.org/2000/svg">' +
               '<svg><symbol id="icon-Test1" x="0" y="0" viewBox="0 0 28 16"/></svg>' +
               '</svg>'
            );
            const filteringResultWithPostfix = await fs.readFile(path.join(iconsOutputFolder, 'filtering_s.svg'), 'utf8');
            filteringResultWithPostfix.should.equal(
               '<svg xmlns="http://www.w3.org/2000/svg">' +
               '<svg><symbol viewBox="0 0 16 16" id="icon-Test2"/></svg>' +
               '</svg>'
            );
            iconsMeta.should.deep.equal({
               module: 'Test-icons',
               packages: [
                  {
                     name: 'filtering_s',
                     icons: ['icon-Test2']
                  },
                  {
                     name: 'filteringWithSkipClean',
                     icons: ['icon-Test1']
                  },
                  {
                     name: 'filtering',
                     icons: ['icon-Test1']
                  },
                  {
                     name: 'anotherFilter',
                     icons: ['icon-AnotherTest']
                  }
               ]
            });
         } else {
            iconsMeta.should.deep.equal({
               module: 'Test-icons',
               packages: [
                  {
                     name: 'filteringWithSkipClean',
                     icons: ['icon-Test1']
                  },
                  {
                     name: 'anotherFilter',
                     icons: ['icon-AnotherTest']
                  }
               ]
            });
         }
      };

      await testResults(true);
      await runWorkflowWithTimeout();
      await testResults(true);

      // remove remaining allowed icon from 'filtering' namespace to check that garbage
      // collector will remove package also with removed svg.
      await fs.remove(path.join(sourceFolder, 'Test-icons/filtering/icon-Test1.svg'));
      await fs.remove(path.join(sourceFolder, 'Test-icons/filtering/icon-Test2.svg'));

      await runWorkflowWithTimeout();
      await testResults(false);

      await clearWorkspace();
   });
   it('get icon size by viewBox', () => {
      let result = getIconSizeByViewBox('0 0 16 16');
      expect(result).equal('s');
      result = getIconSizeByViewBox('0 0 20 20');
      expect(result).equal('sm');
      result = getIconSizeByViewBox('0 0 24 24');
      expect(result).equal('l');

      // size could be determined properly if upperRightX and
      // upperRightY coordinates of viewBox parameter are equal
      result = getIconSizeByViewBox('0 0 24 20');
      expect(result).equal('');

      // any unknown size must be ignored
      result = getIconSizeByViewBox('0 0 50 50');
      expect(result).equal('');
   });
});

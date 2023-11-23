'use strict';

const initTest = require('./init-test');
const { getIconInfoByPath, addLangInContents } = require('../lib/icons/helpers');
const ModuleInfo = require('../gulp/builder/classes/module-info');
const PosixVinyl = require('../lib/platform/vinyl');
const { expect } = require('chai');
const path = require('path').posix;

describe('fonts generator', () => {
   const prepareEnvironment = (relativePaths) => {
      const moduleInfo = new ModuleInfo(
         {
            name: 'MyModule',
            path: 'someRoot/MyModule'
         },
         null,
         'someCache'
      );
      const files = {};
      relativePaths.forEach((relativePath) => {
         files[relativePath] = new PosixVinyl({
            pBase: moduleInfo.path,
            pPath: path.join(moduleInfo.path, relativePath),
            contents: Buffer.from('test123'),
            moduleInfo
         });
      });

      return { files, moduleInfo };
   };

   before(async() => {
      await initTest();
   });

   it('add lang into contents meta', () => {
      const { files, moduleInfo } = prepareEnvironment(['lang/en/sort/icon.svg', 'lang/ar/sort/icon.svg', 'lang/en/common/icon.svg', 'region/GB/lang/en/arrow/icon.svg']);

      let iconInfo = getIconInfoByPath({ langs: ['en'] }, moduleInfo, files['lang/en/sort/icon.svg']);
      addLangInContents(moduleInfo, iconInfo);
      iconInfo = getIconInfoByPath({ langs: ['ar'] }, moduleInfo, files['lang/ar/sort/icon.svg']);
      addLangInContents(moduleInfo, iconInfo);
      iconInfo = getIconInfoByPath({ langs: ['en'] }, moduleInfo, files['lang/en/common/icon.svg']);
      addLangInContents(moduleInfo, iconInfo);
      iconInfo = getIconInfoByPath({ langs: ['en'], countries: ['GB'] }, moduleInfo, files['region/GB/lang/en/arrow/icon.svg']);
      addLangInContents(moduleInfo, iconInfo);

      expect(moduleInfo.contents.modules[moduleInfo.name]).to.deep.equal({ icons: { sort: ['en', 'ar'], common: ['en'], arrow: ['en'] } });
   });

   describe('icon meta', () => {
      it('ignore root icons', () => {
         const { files, moduleInfo } = prepareEnvironment(['icon.svg']);

         const iconInfo = getIconInfoByPath({}, moduleInfo, files['icon.svg']);

         expect(iconInfo.ignore).to.equal(true);
      });

      it('ignore icons with oversize', () => {
         const { files, moduleInfo } = prepareEnvironment(['sort/icon.svg']);

         files['sort/icon.svg'].stat = { size: 100000 };
         const iconInfo = getIconInfoByPath({}, moduleInfo, files['sort/icon.svg']);

         expect(iconInfo).to.deep.equal({
            move: `${moduleInfo.path}/sort/moved/icon.svg`
         });
      });

      it('ignore nested icons', () => {
         const { files, moduleInfo } = prepareEnvironment(['sort/anotherFolder/icon.svg']);

         const iconInfo = getIconInfoByPath({}, moduleInfo, files['sort/anotherFolder/icon.svg']);

         expect(iconInfo.ignore).to.equal(true);
      });

      describe('lang namespace', () => {
         it('ignore icons without language namespace', () => {
            const { files, moduleInfo } = prepareEnvironment(['lang/icon.svg']);

            const iconInfo = getIconInfoByPath({}, moduleInfo, files['lang/icon.svg']);

            expect(iconInfo.ignore).to.equal(true);
         });

         it('ignore icons from unlisted languages', () => {
            const { files, moduleInfo } = prepareEnvironment(['lang/ar/icon.svg']);

            const iconInfo = getIconInfoByPath({ langs: ['en'] }, moduleInfo, files['lang/ar/icon.svg']);

            expect(iconInfo.ignore).to.equal(true);
         });

         it('get correct icon info for listed language', () => {
            const { files, moduleInfo } = prepareEnvironment(['lang/en/icon.svg']);

            const iconInfo = getIconInfoByPath({ langs: ['en'] }, moduleInfo, files['lang/en/icon.svg']);

            expect(iconInfo).to.deep.equal({ ignore: true });
         });

         it('ignore icon for listed language without font namespace', () => {
            const { files, moduleInfo } = prepareEnvironment(['lang/en/sort/icon.svg']);

            const iconInfo = getIconInfoByPath({ langs: ['en'] }, moduleInfo, files['lang/en/sort/icon.svg']);

            expect(iconInfo).to.deep.equal({
               fontName: 'sort',
               language: 'en',
               svgSourcesPath: 'someCache/MyModule/lang/en/sort'
            });
         });

         it('ignore icon for listed language from lang namespace nested folders', () => {
            const { files, moduleInfo } = prepareEnvironment(['lang/en/sort/folder/icon.svg']);

            const iconInfo = getIconInfoByPath({ langs: ['en'] }, moduleInfo, files['lang/en/sort/folder/icon.svg']);

            expect(iconInfo.ignore).to.equal(true);
         });
      });

      describe('region namespace', () => {
         it('ignore icons without region namespace', () => {
            const { files, moduleInfo } = prepareEnvironment(['region/icon.svg']);

            const iconInfo = getIconInfoByPath({ countries: ['GB'] }, moduleInfo, files['region/icon.svg']);

            expect(iconInfo.ignore).to.equal(true);
         });

         it('ignore icons from unlisted regions', () => {
            const { files, moduleInfo } = prepareEnvironment(['region/KZ/sort/icon.svg']);

            const iconInfo = getIconInfoByPath({ countries: ['GB'] }, moduleInfo, files['region/KZ/sort/icon.svg']);

            expect(iconInfo.ignore).to.equal(true);
         });

         describe('with lang namespace', () => {
            it('ignore region icons with nested folders', () => {
               const { files, moduleInfo } = prepareEnvironment(['region/GB/sort/folder/icon.svg']);

               const iconInfo = getIconInfoByPath({ countries: ['GB'] }, moduleInfo, files['region/GB/sort/folder/icon.svg']);

               expect(iconInfo.ignore).to.equal(true);
            });

            it('ignore region folders', () => {
               const { files, moduleInfo } = prepareEnvironment(['region/GB/sort/iconFolder']);

               const iconInfo = getIconInfoByPath({ countries: ['GB'] }, moduleInfo, files['region/GB/sort/iconFolder']);

               expect(iconInfo.ignore).to.equal(true);
            });

            it('region icon should be moved into current root namespace', () => {
               const { files, moduleInfo } = prepareEnvironment(['region/GB/sort/icon.svg']);

               const iconInfo = getIconInfoByPath({ countries: ['GB'] }, moduleInfo, files['region/GB/sort/icon.svg']);

               expect(iconInfo).to.deep.equal({
                  copy: 'someCache/MyModule/sort/icon.svg',
                  relative: 'sort/icon.svg',
                  region: 'GB',
                  fontName: 'sort',
                  svgSourcesPath: 'someCache/MyModule/sort'
               });
            });
         });

         describe('without lang namespace', () => {
            it('ignore region icons from unlisted languages', () => {
               const { files, moduleInfo } = prepareEnvironment(['region/GB/lang/kk/sort/iconFolder']);

               const iconInfo = getIconInfoByPath({ langs: ['en'], countries: ['GB'] }, moduleInfo, files['region/GB/lang/kk/sort/iconFolder']);

               expect(iconInfo.ignore).to.equal(true);
            });

            it('ignore region icons from from root lang folder', () => {
               const { files, moduleInfo } = prepareEnvironment(['region/GB/lang/en/sort.svg']);

               const iconInfo = getIconInfoByPath({ langs: ['en'], countries: ['GB'] }, moduleInfo, files['region/GB/lang/en/sort.svg']);

               expect(iconInfo.ignore).to.equal(true);
            });

            it('ignore region icons from from lang namespace nested folders', () => {
               const { files, moduleInfo } = prepareEnvironment(['region/GB/lang/en/sort/folder/icon.svg']);

               const iconInfo = getIconInfoByPath({ langs: ['en'], countries: ['GB'] }, moduleInfo, files['region/GB/lang/en/sort/folder/icon.svg']);

               expect(iconInfo.ignore).to.equal(true);
            });

            it('region icon with lang namespace should be moved into current root lang namespace', () => {
               const { files, moduleInfo } = prepareEnvironment(['region/GB/lang/en/sort/icon.svg']);

               const iconInfo = getIconInfoByPath({ langs: ['en'], countries: ['GB'] }, moduleInfo, files['region/GB/lang/en/sort/icon.svg']);

               expect(iconInfo).to.deep.equal({
                  copy: 'someCache/MyModule/lang/en/sort/icon.svg',
                  relative: 'lang/en/sort/icon.svg',
                  fontName: 'sort',
                  language: 'en',
                  region: 'GB',
                  svgSourcesPath: 'someCache/MyModule/lang/en/sort'
               });
            });
         });
      });
   });
});

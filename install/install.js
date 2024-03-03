const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const { REPOS } = require('./constants.js');
const packageJsonPath = path.join(__dirname, '../package.json');
const originalPackageJson = fs.readFileSync(packageJsonPath, 'utf8');
const packageJson = JSON.parse(originalPackageJson);
const defaultBranch = `rc-${packageJson.version.slice(0, packageJson.version.lastIndexOf('.'))}`;


function execute(command, options = {}) {
   return new Promise(async(resolve, reject) => {
      console.log(`Start ${command}`);

      const child = childProcess.exec(command, {
         ...{
            cwd: path.join(__dirname, '../')
         },
         ...options
      });

      child.stdout.on('data', (data) => {
         console.log(data.toString());
      });


      child.stderr.on('data', (data) => {
         console.log(data.toString());
      });

      child.on('exit', (code) => {
         if (code !== 0) {
            reject(new Error(`${command} was finished with errors`));

            return;
         }

         console.log(`${command} done`);

         resolve();
      });
   });
}

function deleteRep(repPath) {
   return new Promise((resolve, reject) => {
      fs.rmdir(repPath, {
         recursive: true
      }, (err) => {
         if (err) {
            reject(err);

            return;
         }

         resolve();
      });
   });
}

async function cloneRep(name, rep) {
   const [url, branch] = rep.split('#');
   const command = `git clone --depth 1 "${url}" --branch "${branch || defaultBranch}" --single-branch "${name}"`;

   const output = path.join(__dirname, '../node_modules', name);

   if (fs.existsSync(output)) {
      await deleteRep(output);
   }

   await execute(command, {
      cwd: 'node_modules'
   });

   if (name === 'sbis3-ws') {
      await execute('node "saby-typescript/cli.js" --install --mode=development --tslib=sbis3-ws/WS.Core/ext/tslib.js --globalTypings=sbis3-ws/WS.Core/global.d.ts --tsconfig=skip --tslint=skip', {
         cwd: 'node_modules'
      });
   }
}

async function install() {
   await execute('npm install');

   const installingRepos = [];

   for (const [name, url] of Object.entries(REPOS)) {
      installingRepos.push(cloneRep(name, url));
   }

   await Promise.all(installingRepos);
}

install().then(() => {
   console.log('Installing done');
}, (err) => {
   console.error(err);
   process.exit(1);
});

const core = require('@actions/core');
const github = require('@actions/github');
const { parseScript } = require('meriyah');
const path = require('path');
const fs = require('fs');
let isHit = false;

async function run() {
  function searchTree(tree, filepath) {
    Object.keys(tree).forEach((key) => {
      if (key === filepath) {
        isHit = true;
      } else {
        searchTree(tree[key], filepath)
      }
    })
  }

  try {
    let targetEndpoints = ['## 変更エンドポイント一覧'];

    // ファイル名取得
    const payloadObj = github.context.payload;
    const myToken = core.getInput('my-token');
    const octokit = github.getOctokit(myToken);

    const owner = payloadObj.repository.owner.login;
    const repo = payloadObj.repository.name;
    const pull_number = payloadObj.pull_request.number;

    const pullFiles = await octokit.rest.pulls.listFiles({ owner, repo, pull_number });
    const allPullFileNames = pullFiles.data.map((datum) => datum.filename);
    const targetExts = core.getInput('trigger-file-exts').split(',');
    const ignoreFilePattern = core.getInput('ignore-pattern');
    const pullFileNames = allPullFileNames.filter((filename) => {
      if (!targetExts.includes(path.extname(filename))) { return false }
      if (!ignoreFilePattern) { return true }
      if (filename.match(ignoreFilePattern)) { return false }
      return true
    });

    // ファイル検索
    let import_pathes = {};
    let endpoints = {};
    const routeFileName = core.getInput('routes-file-name');
    fs.readFile(routeFileName, 'utf8', function (err, data) {
      const test = parseScript(data, { module: true });
      test.body.forEach((arr) => {
        if (arr.type == 'ImportDeclaration') {
          let import_path = {};
          import_path[arr.specifiers[0].local.name] = arr.source.value;
          Object.assign(import_pathes, import_path);
        }
        if (arr.type == 'VariableDeclaration') {
          if (arr.declarations[0].id.name == 'routes') {
            arr.declarations[0].init.elements.map(ele => {
              let endpoint = {};
              endpoint[ele.properties[1].value.name] = ele.properties[0].value.value;
              Object.assign(endpoints, endpoint);
            })
          }
        }
      })
      pullFileNames.forEach((pullFileName) => {
        Object.keys(endpoints).forEach((key) => {
          isHit = false;
          const componentPath = path.resolve(path.dirname(routeFileName), import_pathes[key]);
          const { tree } = require('get-dependency-tree')({ entry: `${componentPath}.vue` })
          searchTree(tree, path.join(process.cwd(), pullFileName));
          if (isHit) { targetEndpoints.push(endpoints[key]) }
        })
      })

      if (targetEndpoints.length === 1) { targetEndpoints.push('なし') }

      // プルリクコミット
      octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: pull_number,
        body: Array.from(new Set(targetEndpoints)).join('\n'),
      });
    });
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
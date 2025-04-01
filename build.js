#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const child_process = require('child_process')
const crypto = require('crypto')

// 简单封装下日志打印
// .debug().info().warn().error()
function getLogger () {
    return console;
}

var Md5Calculator = function () {
    async function md5file (filePath) {
        return new Promise((resolve, reject) => {
            // const hash = crypto.createHash('sha256');
            const hash = crypto.createHash('md5');
            const input = fs.createReadStream(filePath);
            input.on('readable', () => {
                const data = input.read();
                if (data) {
                    hash.update(data);
                } else {
                    resolve(hash.digest('hex'));
                }
            });
        })
    }

    this.md5file = md5file;
}

function Md5RenameHelper(){

    async function md5RenameFile(filePath){
        // md5 suffix
        const md5Calculator = new Md5Calculator();
        const zipMd5 = await md5Calculator.md5file(filePath)

        const fileName = path.basename(filePath);
        if (fileName.indexOf("_md5.")>=0){
            console.error("md5 seems already in file name, ignore")
            return;
        }

        const extname = path.extname(filePath);
        const fileNameWithNoExt = path.basename(filePath, extname);

        getLogger().info(fileName+" md5:"+zipMd5)
        const fileWithMd5FileName = fileNameWithNoExt+"_md5."+zipMd5.substr(-4)+extname;
        const dstFileWithMd5SuffixPath = path.resolve(path.dirname(filePath),fileWithMd5FileName)
        getLogger().info("renaming to "+fileWithMd5FileName)
        fs.renameSync(filePath, dstFileWithMd5SuffixPath)
        return dstFileWithMd5SuffixPath
    }

    async  function md5RenameFilesInFolder() {
        //TODO
    }


    async function md5RenamePath(srcPath) {
        getLogger().info("rename path:"+srcPath)
        let isSrcPathFile = true;
        //暂时只支持文件类型的路径，后续再考虑目录类型的路径
        if (isSrcPathFile){
            return await md5RenameFile(srcPath);
        }
    }

    this.md5RenamePath = md5RenamePath;
}

var BuildHelper = function () {
    /**
     * 
     * @param {*} param 
     * @returns 
     */
    function checkParam (param) {
        return process.argv.length > 2 && process.argv[2].indexOf(param) >= 0;
    }

    function getGradlewCmd () {
        const platform = process.platform;
        getLogger().info("platform:" + platform);
        switch (platform) {
            case "win32":
                return "gradlew.bat"
            case "linux":
                return "./gradlew"
            default:
                return "gradlew.bat"
        }
    }

    this.checkParam = checkParam;
    this.getGradlewCmd = getGradlewCmd;
}

var GradleBuilder = function () {
    const buildHelper = new BuildHelper();
    const gradleCmd = buildHelper.getGradlewCmd();

    function executeGradleTarget (gradleTarget) {
        getLogger().info("gradle target:" + gradleTarget)
        const fullCmd = gradleCmd + " " + gradleTarget
        getLogger().info("======== start "+fullCmd)
        return new Promise((resolve, reject)=>{
            // spawn可以继承process的stdio，保留tty属性，可以显示颜色或者响应ctrl+c以及实时显示
            const cmdProc = child_process.spawn(gradleCmd, [gradleTarget], { stdio: "inherit" })
            cmdProc.on("close", (code) => {
                getLogger().info("===== finish "+fullCmd+", code:"+code)
                if (code != 0) {
                    reject(code)
                    return
                }
                resolve()
            })
        /*
            const cmdProc = child_process.exec(fullCmd, (err, stdout, stderr) =>{
                if (err){
//                    getLogger().error(stderr)
                    getLogger().error("gradle error:"+error)
                    reject(error, stderr)
                    return
                }
//                getLogger().info(stdout)
//                getLogger().error(stderr)
                getLogger().info("===== finish "+fullCmd)
                resolve()
            });
            // 实时输出显示
            cmdProc.stdout.pipe(process.stdout)
            cmdProc.stderr.pipe(process.stderr)
            */
        })
    }

    function capitalizeStr(str){
        if (!str){
            return str
        }
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    async function buildModuleApkWithMd5Rename (moduleName, flavor, targetDir, skipClean) {
        getLogger().info(`moduleName:${moduleName}, skipClean:${skipClean}`)
        if (!skipClean){
            await executeGradleTarget("clean")
        }
        await executeGradleTarget(`:${moduleName}:assemble${capitalizeStr(flavor)||""}Release`)

        getLogger().info("start to md5 rename...")
        const apkSrcPathDefault = path.join(__dirname, `${moduleName}/build/outputs/apk${flavor?"/"+flavor:""}/release/${moduleName}-release.apk`)

        // 2024.1.19: 兼容下apk输出名称被修改了，不是默认的名称的场景
        // 直接将目录下所有的apk都处理
        let apkSrcPathList = []
        if (fs.existsSync(apkSrcPathDefault)) {
            // 文件存在
            apkSrcPathList.push(apkSrcPathDefault)
        }else{
            // 文件不存在，尝试获取目录下的所有 APK 文件路径列表
            const directoryPath = path.dirname(apkSrcPathDefault);
            try {
                const files = fs.readdirSync(directoryPath);
                const apkFiles = files.filter(file => file.endsWith('.apk'));
                if (apkFiles.length > 0) {
                    apkSrcPathList = apkFiles.map(file => path.join(directoryPath, file));
                    console.log('APK 文件列表：', apkSrcPathList);
                } else {
                    console.error('在指定目录下找不到任何 APK 文件。');
                }
            } catch (err) {
                console.error('Error reading directory:', err);
            }
        }

        for (let apkSrcPath of apkSrcPathList){
            const apkWithMd5Path = await new Md5RenameHelper().md5RenamePath(apkSrcPath)
            if (targetDir){
                getLogger().info("copy to target dir:"+targetDir)
                fs.copyFileSync(apkWithMd5Path, path.resolve(targetDir, path.basename(apkWithMd5Path)))
            }
        }
    }


    async function buildAppModule (targetDir, skipClean) {
        getLogger().info("buildDeviceApp")
        const moduleName = "app"
        await buildModuleApkWithMd5Rename(moduleName, null, targetDir, skipClean)
    }

    this.buildModuleApkWithMd5Rename = buildModuleApkWithMd5Rename
    this.buildAppModule = buildAppModule;
}




async function main () {
    getLogger().info("main start")
    process.chdir(__dirname)

    // 参考原python脚本，编译的apk复制到上级目录中去
    const targetDir = path.resolve(__dirname, "..")

    const param = process.argv[2];

    const skipClean = param && param.indexOf("noclean") >= 0
    let buildApp = param && param.indexOf("app") >= 0

    if (!param){
        getLogger().info("no param, build device as default")
        buildApp = true
    }

    const gradleBuilder = new GradleBuilder();
    if (buildApp){
        await gradleBuilder.buildAppModule(targetDir, skipClean);
    }

    getLogger().info("main end")
    getLogger().info(new Date().toLocaleString())
}

main()
//.finally(()=>{
//  console.log('Press any key to exit');
//  //process.stdin.setRawMode(true);
//  //process.stdin.resume();
//  process.stdin.on('data', process.exit.bind(process, 0));
//});

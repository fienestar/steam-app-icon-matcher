import plist from 'simple-plist';
import path from 'path';
import fs from 'fs';
import readline from 'readline';
import SteamUser from 'steam-user';
import https from 'https';

const user = new SteamUser();
user.logOn();

function getInput(message?: string): Promise<string> {
    if (message === undefined) {
        message = '';
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise((resolve) => {
        rl.question(message as string, (code) => {
            rl.close();
            resolve(code);
        });
    });
}

type PromiseLikeHandler<Error, Result> = (error: Error|null, result: Result|null) => void;
type PromiseLike<Error, Result> = (cb: PromiseLikeHandler<Error, Result>) => void;
function toPromise<Error, Result>(promiseLike: PromiseLike<Error, Result>) {
    return new Promise<Result>((resolve, reject) => promiseLike((err: Error|null, result: Result|null) => {
        if (err !== null || result === null) reject(err);
        else resolve(result);
    }));
}

async function patchAppIconPath(appPath: string, iconPath: string) {
    const plistPath = path.join(appPath, 'Info.plist');
    const data = await toPromise(plist.readFile.bind(plist, plistPath)) as { [key: string]: string};
    data.CFBundleIconFile = iconPath;
    await toPromise(plist.writeFile.bind(plist, plistPath, data, {}));
}

async function getAppId(appPath: string) {
    const shPath = path.join(appPath, 'MacOS', 'run.sh');
    const shBuffer = await toPromise(fs.readFile.bind(fs, shPath));
    const shString = shBuffer.toString();
    const runString = 'steam://run/';
    const appId = shString.substring(shString.indexOf(runString) + runString.length).trim();
    return +appId;
}

type AppInfo = {
    common: {
        name: string
        clienticon: string,
    }
}

async function getIconURI(appId: number) {
    const productInfo = await user.getProductInfo([appId], []);
    const appInfo = productInfo.apps[appId].appinfo as AppInfo;
    const icon = appInfo.common.clienticon;
    console.log(`Getting icon for ${appInfo.common.name}...`);
    const iconURI = `https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/${appId}/${icon}.ico`;
    return iconURI;
}

async function matchAppIcon(appPath: string) {
    const appId = await getAppId(appPath);
    const iconURI = await getIconURI(appId);
    const fileName = iconURI.split('/').pop() as string;
    const resourcePath = path.join(appPath, 'Resources');
    const file = fs.createWriteStream(path.join(resourcePath, fileName));
    await new Promise<void>((resolve) => https.get(iconURI, (response) => {
        response.pipe(file);
        file.on('finish', () => {
            file.close(() => resolve());
        });
    }));
    await patchAppIconPath(appPath, fileName);
    return;
}


async function app() {
    const dirPath = await getInput('Enter the path to the app folder: ');
    const dir = await toPromise(fs.readdir.bind(fs, dirPath, {withFileTypes: true}));
    await Promise.all(dir.map(async (element) => {
        if (element.isDirectory()) {
            await matchAppIcon(path.join(dirPath, element.name, 'Contents'));
        }
    }));
}

user.on('loggedOn', () => {
    app()
        .then(() => {
            console.log('Done!');
            process.exit(0);
        })
        .catch((error) => {
            console.error(error);
        });
});

import * as path from "path";
import * as fs from "fs";
import * as util from "util";
import * as crypto from "crypto";
import * as http from "http";
import * as url_utils from "url";
import * as cp from "child_process";
import * as mt from "mime-types";
import * as os from "os";

/* All project files */

type ProjectResourceType = "html" | "js" | "css" | "wasm" | "wav" | "json" | "img" | "i18n" | "pem";
type ProjectResource = {
    "type": ProjectResourceType;
    "build-target": "dev" | "rel" | "dev|rel";

    "web-only"?: boolean;
    "client-only"?: boolean;

    "search-pattern": RegExp;
    "search-exclude"?: RegExp;
    "req-parm"?: string[];

    "path": string;
    "local-path": string;
}

const APP_FILE_LIST_SHARED_SOURCE: ProjectResource[] = [
    { /* shared html and php files */
        "type": "html",
        "search-pattern": /^([a-zA-Z]+)\.(html|php|json)$/,
        "build-target": "dev|rel",

        "path": "./",
        "local-path": "./shared/html/"
    },

    { /* javascript loader */
        "type": "js",
        "search-pattern": /.*\.js$/,
        "build-target": "dev",

        "path": "loader/",
        "local-path": "./shared/loader/"
    },
    { /* javascript loader for releases */
        "type": "js",
        "search-pattern": /.*loader_[\S]+.min.js$/,
        "build-target": "rel",

        "path": "loader/",
        "local-path": "./shared/generated/"
    },

    { /* shared javascript files (WebRTC adapter) */
        "type": "js",
        "search-pattern": /.*\.js$/,
        "build-target": "dev|rel",

        "path": "adapter/",
        "local-path": "./shared/adapter/"
    },

    { /* shared javascript files (development mode only) */
        "type": "js",
        "search-pattern": /.*\.js$/,
        "search-exclude": /(.*\/)?workers\/.*/,
        "build-target": "dev",

        "path": "js/",
        "local-path": "./shared/js/"
    },
    { /* shared javascript mapping files (development mode only) */
        "type": "js",
        "search-pattern": /.*\.(js.map|ts)$/,
        "search-exclude": /(.*\/)?workers\/.*/,
        "build-target": "dev",

        "path": "js/",
        "local-path": "./shared/js/",
        "req-parm": ["--mappings"]
    },

    { /* shared generated worker codec */
        "type": "js",
        "search-pattern": /(WorkerPOW.js)$/,
        "build-target": "dev|rel",

        "path": "js/workers/",
        "local-path": "./shared/js/workers/"
    },
    { /* shared developer single css files */
        "type": "css",
        "search-pattern": /.*\.css$/,
        "build-target": "dev",

        "path": "css/",
        "local-path": "./shared/css/"
    },
    { /* shared css mapping files (development mode only) */
        "type": "css",
        "search-pattern": /.*\.(css.map|scss)$/,
        "build-target": "dev",

        "path": "css/",
        "local-path": "./shared/css/",
        "req-parm": ["--mappings"]
    },
    { /* shared release css files */
        "type": "css",
        "search-pattern": /.*\.css$/,
        "build-target": "rel",

        "path": "css/",
        "local-path": "./shared/generated/"
    },
    { /* shared release css files */
        "type": "css",
        "search-pattern": /.*\.css$/,
        "build-target": "rel",

        "path": "css/loader/",
        "local-path": "./shared/css/loader/"
    },
    { /* shared release css files */
        "type": "css",
        "search-pattern": /.*\.css$/,
        "build-target": "dev|rel",

        "path": "css/theme/",
        "local-path": "./shared/css/theme/"
    },
    { /* shared sound files */
        "type": "wav",
        "search-pattern": /.*\.wav$/,
        "build-target": "dev|rel",

        "path": "audio/",
        "local-path": "./shared/audio/"
    },
    { /* shared data sound files */
        "type": "json",
        "search-pattern": /.*\.json/,
        "build-target": "dev|rel",

        "path": "audio/",
        "local-path": "./shared/audio/"
    },
    { /* shared image files */
        "type": "img",
        "search-pattern": /.*\.(svg|png)/,
        "build-target": "dev|rel",

        "path": "img/",
        "local-path": "./shared/img/"
    },
    { /* own webassembly files */
        "type": "wasm",
        "search-pattern": /.*\.(wasm)/,
        "build-target": "dev|rel",

        "path": "wat/",
        "local-path": "./shared/wat/"
    }
];

const APP_FILE_LIST_SHARED_VENDORS: ProjectResource[] = [
    {
        "type": "js",
        "search-pattern": /.*(\.min)?\.js$/,
        "build-target": "dev|rel",

        "path": "vendor/",
        "local-path": "./vendor/"
    },
    {
        "type": "css",
        "search-pattern": /.*\.css$/,
        "build-target": "dev|rel",

        "path": "vendor/",
        "local-path": "./vendor/"
    }
];

const APP_FILE_LIST_CLIENT_SOURCE: ProjectResource[] = [
    { /* client css files */
        "client-only": true,
        "type": "css",
        "search-pattern": /.*\.css$/,
        "build-target": "dev|rel",

        "path": "css/",
        "local-path": "./client/css/"
    },
    { /* client js files */
        "client-only": true,
        "type": "js",
        "search-pattern": /.*\.js/,
        "build-target": "dev",

        "path": "js/",
        "local-path": "./client/js/"
    },

    /* release specific */
    { /* web merged javascript files (shared inclusive) */
        "client-only": true,
        "type": "js",
        "search-pattern": /.*\.js$/,
        "build-target": "rel",

        "path": "js/",
        "local-path": "./client/generated/"
    },
    { /* Add the shared generated files. Exclude the shared file because we're including it already */
        "client-only": true,
        "type": "js",
        "search-pattern": /.*\.js$/,
        "search-exclude": /shared\.js(.map)?$/,
        "build-target": "rel",

        "path": "js/",
        "local-path": "./shared/generated/"
    }
];

const APP_FILE_LIST_WEB_SOURCE: ProjectResource[] = [
    { /* generated assembly files */
        "web-only": true,
        "type": "wasm",
        "search-pattern": /.*\.(wasm)/,
        "build-target": "dev|rel",

        "path": "wasm/",
        "local-path": "./asm/generated/"
    },
    { /* generated assembly javascript files */
        "web-only": true,
        "type": "js",
        "search-pattern": /.*\.(js)/,
        "build-target": "dev|rel",

        "path": "wasm/",
        "local-path": "./asm/generated/"
    },
    { /* web generated worker codec */
        "web-only": true,
        "type": "js",
        "search-pattern": /(WorkerCodec.js)$/,
        "build-target": "dev|rel",

        "path": "js/workers/",
        "local-path": "./web/js/workers/"
    },
    { /* web javascript files (development mode only) */
        "web-only": true,
        "type": "js",
        "search-pattern": /.*\.js$/,
        "build-target": "dev",

        "path": "js/",
        "local-path": "./web/js/"
    },
    { /* web merged javascript files (shared inclusive) */
        "web-only": true,
        "type": "js",
        "search-pattern": /client(\.min)?\.js$/,
        "build-target": "rel",

        "path": "js/",
        "local-path": "./web/generated/"
    },
    { /* web css files */
        "web-only": true,
        "type": "css",
        "search-pattern": /.*\.css$/,
        "build-target": "dev|rel",

        "path": "css/",
        "local-path": "./web/css/"
    },
    { /* web html files */
        "web-only": true,
        "type": "html",
        "search-pattern": /.*\.(php|html)/,
        "build-target": "dev|rel",

        "path": "./",
        "local-path": "./web/html/"
    },
    { /* translations */
        "web-only": true, /* Only required for the web client */
        "type": "i18n",
        "search-pattern": /.*\.(translation|json)/,
        "build-target": "dev|rel",

        "path": "i18n/",
        "local-path": "./shared/i18n/"
    }
];

const APP_FILE_LIST_WEB_TEASPEAK: ProjectResource[] = [
    /* special web.teaspeak.de only auth files */
    { /* login page and api */
        "web-only": true,
        "type": "html",
        "search-pattern": /[a-zA-Z_0-9]+\.(php|html)$/,
        "build-target": "dev|rel",

        "path": "./",
        "local-path": "./auth/",
        "req-parm": ["-xf"]
    },
    { /* javascript  */
        "web-only": true,
        "type": "js",
        "search-pattern": /.*\.js$/,
        "build-target": "dev|rel",

        "path": "js/",
        "local-path": "./auth/js/",
        "req-parm": ["-xf"]
    },
    { /* web css files */
        "web-only": true,
        "type": "css",
        "search-pattern": /.*\.css$/,
        "build-target": "dev|rel",

        "path": "css/",
        "local-path": "./auth/css/",
        "req-parm": ["-xf"]
    },
    { /* certificates */
        "web-only": true,
        "type": "pem",
        "search-pattern": /.*\.pem$/,
        "build-target": "dev|rel",

        "path": "certs/",
        "local-path": "./auth/certs/",
        "req-parm": ["-xf"]
    }
];

const CERTACCEPT_FILE_LIST: ProjectResource[] = [
    { /* html files */
        "type": "html",
        "search-pattern": /^([a-zA-Z]+)\.(html|php|json)$/,
        "build-target": "dev|rel",

        "path": "./popup/certaccept/",
        "local-path": "./shared/popup/certaccept/html/"
    },

    { /* javascript loader (debug) */
        "type": "js",
        "search-pattern": /(loader|certaccept)\.js$/,
        "build-target": "dev",

        "path": "./popup/certaccept/loader/",
        "local-path": "./shared/loader/"
    },
    { /* javascript loader (releases) */
        "type": "js",
        "search-pattern": /.*loader_certaccept.min.js$/,
        "build-target": "rel",

        "path": "./popup/certaccept/loader/",
        "local-path": "./shared/generated/"
    },

    { /* javascript imported from shared for debug */
        "type": "js",
        "search-pattern": /^(BrowserIPC|log|proto|settings)\.js$/,
        "build-target": "dev",

        "path": "./popup/certaccept/js/",
        "local-path": "./shared/js/"
    },

    { /* javascript for debug */
        "type": "js",
        "search-pattern": /^certaccept\.min\.js$/,
        "build-target": "rel",

        "path": "./popup/certaccept/js/",
        "local-path": "./shared/generated/"
    },

    { /* javascript for release */
        "type": "js",
        "search-pattern": /^.*\.js$/,
        "build-target": "dev",

        "path": "./popup/certaccept/js/",
        "local-path": "./shared/popup/certaccept/js/"
    },

    { /* shared css files */
        "type": "css",
        "search-pattern": /.*\.css$/,
        "build-target": "dev|rel",

        "path": "./popup/certaccept/css/loader/",
        "local-path": "./shared/css/loader/"
    },

    { /* shared css files */
        "type": "css",
        "search-pattern": /.*\.css$/,
        "build-target": "dev|rel",

        "path": "./popup/certaccept/css/static/",
        "local-path": "./shared/popup/certaccept/css/static/"
    },

    { /* img files */
        "type": "img",
        "search-pattern": /^(loading_error.*)\.(svg)$/,
        "build-target": "dev|rel",

        "path": "./popup/certaccept/img/",
        "local-path": "./shared/img/"
    },

    { /* jquery vendor */
        "type": "js",
        "search-pattern": /^jquery\/.*\.js$/,
        "build-target": "dev|rel",

        "path": "./popup/certaccept/vendor/",
        "local-path": "./vendor/"
    },
];

const APP_FILE_LIST = [
        ...APP_FILE_LIST_SHARED_SOURCE,
        ...APP_FILE_LIST_SHARED_VENDORS,
        ...APP_FILE_LIST_CLIENT_SOURCE,
        ...APP_FILE_LIST_WEB_SOURCE,
        ...APP_FILE_LIST_WEB_TEASPEAK,
        ...CERTACCEPT_FILE_LIST,
];

/* the generator */
namespace generator {
    export type SearchOptions = {
        target: "client" | "web";
        mode: "rel" | "dev";

        source_path: string;
        parameter: string[];
    };

    export type Entry = {
        target_path: string; /* relative */
        local_path: string; /* absolute */

        name: string;
        type: ProjectResourceType;
        hash: string;
    }

    async function sha(type: "sha1" | "sha256", file: string) : Promise<string> {
        const result = crypto.createHash(type);

        const fis = fs.createReadStream(file);
        await new Promise((resolve, reject) => {
            fis.on("error", reject);
            fis.on("end", resolve);

            fis.on("data", chunk => result.update(chunk));
        });

        return result.digest("hex");
    }

    export async function search_files(files: ProjectResource[], options: SearchOptions) : Promise<Entry[]> {
        const result: Entry[] = [];

        const readdir = util.promisify(fs.readdir);
        const stat = util.promisify(fs.stat);
        const rreaddir = async p => {
            const result = [];
            try {
                const files = await readdir(p);
                for(const file of files) {
                    const file_path = path.join(p, file);

                    const info = await stat(file_path);
                    if(info.isDirectory()) {
                        result.push(...await rreaddir(file_path));
                    } else {
                        result.push(file_path);
                    }
                }
            } catch(error) {
                if(error.code === "ENOENT")
                    return [];
                throw error;
            }
            return result;
        };

        for(const file of files) {
            if(typeof file["web-only"] === "boolean" && file["web-only"] && options.target !== "web")
                continue;
            if(typeof file["client-only"] === "boolean" && file["client-only"] && options.target !== "client")
                continue;
            if(!file["build-target"].split("|").find(e => e === options.mode))
                continue;
            if(Array.isArray(file["req-parm"]) && file["req-parm"].find(e => !options.parameter.find(p => p.toLowerCase() === e.toLowerCase())))
                continue;

            const normal_local = path.normalize(path.join(options.source_path, file["local-path"]));
            const files: string[] = await rreaddir(normal_local);
            for(const f of files) {
                const local_name = f.substr(normal_local.length);
                if(!local_name.match(file["search-pattern"]) && !local_name.replace("\\\\", "/").match(file["search-pattern"]))
                    continue;

                if(typeof(file["search-exclude"]) !== "undefined" && f.match(file["search-exclude"]))
                    continue;

                const data = {
                    hash: await sha("sha1", f),
                    local_path: f,
                    target_path: path.join(file.path, local_name),
                    name: path.basename(f),
                    type: file.type
                };
                if(result.find(e => e.target_path === data.target_path))
                    continue;
                result.push(data);
            }
        }

        return result;
    }
}

namespace server {
    export type Options = {
        port: number;
        php: string;
    }

    const exists = util.promisify(fs.exists);
    const stat = util.promisify(fs.stat);
    const exec: (command: string) => Promise<{ stdout: string, stderr: string }> = util.promisify(cp.exec);

    let files: (generator.Entry & { http_path: string; })[] = [];
    let server: http.Server;
    let php: string;
    export async function launch(_files: generator.Entry[], options: Options) {
        if(!await exists(options.php) || !(await stat(options.php)).isFile())
            throw "invalid php interpreter (not found)";

        try {
            const info = await exec(options.php + " --version");
            if(info.stderr)
                throw info.stderr;

            if(!info.stdout.startsWith("PHP 7."))
                throw "invalid php interpreter version (Require at least 7)";

            console.debug("Found PHP interpreter at %s:\n%s", options.php, info.stdout);
            php = options.php;
        } catch(error) {
            console.error("failed to validate php interpreter: %o", error);
            throw "invalid php interpreter";
        }
        server = http.createServer(handle_request);
        server.listen(options.port);

        files = _files.map(e =>{
            return {
                type: e.type,
                name: e.name,
                hash: e.hash,
                local_path: e.local_path,
                target_path: e.target_path,
                http_path: "/" + e.target_path.replace(/\\/g, "/")
            }
        });
    }

    export async function shutdown() {
        if(server) {
            await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
            server = undefined;
        }
    }

    function handle_request(request: http.IncomingMessage, response: http.ServerResponse) {
        let url: url_utils.UrlWithParsedQuery;
        try {
            url = url_utils.parse(request.url, true);
        } catch(error) {
            response.writeHead(500);
            response.write("invalid url:\n");
            response.write(error.toString());
            response.end();
            return;
        }

        const file = files.find(e => e.http_path === url.pathname);
        if(!file) {
            console.log("[SERVER] Client requested unknown file %s (%s)", url.pathname, request.url);
            response.writeHead(404);
            response.write("Missing file: " + url.path);
            response.end();
            return;
        }

        let type = mt.lookup(path.extname(file.local_path)) || "text/html";
        console.log("[SERVER] Serving file %s (%s) (%s)", file.target_path, type, file.local_path);
        if(path.extname(file.local_path) === ".php") {
            exec(php + " -d WEB_CLIENT=1 " + file.local_path).then(result => {
                if(result.stderr) {
                    response.writeHead(500);
                    response.write("Encountered error while interpreting PHP script:\n");
                    response.write(result.stderr);
                    response.end();
                    return;
                }

                response.writeHead(200, "success", {
                    "Content-Type": "text/html; charset=utf-8"
                });
                response.write(result.stdout);
                response.end();
            }).catch(error => {
                response.writeHead(500);
                response.write("Received an exception while interpreting PHP script:\n");
                response.write(error.toString());
                response.end();
            });
            return;
        }
        const fis = fs.createReadStream(file.local_path);

        response.writeHead(200, "success", {
            "Content-Type": type + "; charset=utf-8"
        });

        fis.on("end", () => response.end());
        fis.on("error", () => {
            response.write("Ah error happend!");
        });
        fis.on("data", data => response.write(data));
    }
}

function php_exe() : string {
    if(process.env["PHP_EXE"])
        return process.env["PHP_EXE"];
    if(os.platform() === "win32")
        return "C:\\php\\php.exe";
    return "/bin/php";
}

async function main_serve(mode: "rel" | "dev", port: number) {
    const files = await generator.search_files(APP_FILE_LIST, {
        source_path: __dirname,
        parameter: [],
        target: "web",
        mode: mode
    });

    await server.launch(files, {
        port: port,
        php: php_exe(),
    });

    console.log("Server started on %d", port);
    console.log("To stop the server press ^K^C.");
    await new Promise(resolve => {});
}

async function main(args: string[]) {
    if(args.length >= 2) {
        if(args[0].toLowerCase() === "serve") {
            let mode;
            switch (args[1].toLowerCase()) {
                case "dev":
                case "devel":
                case "development":
                    mode = "dev";
                    break;
                case "rel":
                case "release":
                    mode = "rel";
                    break;

                default:
                    console.error("Unknown serve mode %s.", args[1]);
                    return;
            }

            let port = 8081;
            if(args.length >= 3) {
                port = parseInt(args[2]);
                if(Number.isNaN(port) || port <= 0 || port > 65665) {
                    console.log("Invalid HTTP server port: %s", args[2]);
                    return;
                }
            }

            await main_serve(mode, port);
            return;
        }
    }
    if(args.length >= 3) {
        if(args[0].toLowerCase() === "generate" || args[0].toLowerCase() === "gen") {
            console.error("Currently not yet supported");
            return;
        } else if(args[0].toLowerCase() === "list") {
            console.error("Currently not yet supported");
            return;
        }
    }

    console.log("Invalid arguments!");
    console.log("Usage: node files.js <mode> [args...]");
    console.log("       node files.js serve <dev|rel> [port]                      | Start a HTTP server which serves the web client");
    console.log("       node files.js generate <client|web> <dev|rel> [flags...]  | Generate the final environment ready to be packed and deployed");
    console.log("       node files.js list <client|web> <dev|rel>                 | List all project files");
    console.log("");
    console.log("Influential environment variables:")
    console.log("   PHP_EXE   |  Path to the PHP CLI interpreter");
    console.log("             |  Default:");
    console.log("             |    Windows: C:\\php\\php.exe");
    console.log("             |    Linux:   /bin/php");
}
main(process.argv.slice(2)).then(ignore_exit => {
    if(typeof(ignore_exit) === "boolean" && !<any>ignore_exit) return;
    process.exit();
}).catch(error => {
    console.error("Failed to execute application. Exception reached execution root!");
    console.error(error);
});
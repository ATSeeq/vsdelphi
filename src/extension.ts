import * as vscode from 'vscode';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as xml2js from 'xml2js';
import * as path from 'path';

// The name of the extension as defined in package.json
const EXTENSION_NAME = 'vsdelphi';
const MAP_PATCHER_PATH = path.join(__dirname, '..', 'tools', 'MapPatcher', 'MapPatcher.exe');
const MAP2PDB_PATH = path.join(__dirname, '..', 'tools', 'map2pdb', 'map2pdb.exe');

// This method is called when anythin from the `contributes` section 
// of the `package.json` is activated or when an event from the 
// `activationEvents` section is triggered
export function activate(context: vscode.ExtensionContext) {
	registerCmd(context, 'test', testDelphi);
	registerCmd(context, 'build', buildDelphi);
	registerCmd(context, 'run', runDelphi);
	registerCmd(context, 'clean', cleanDelphi);
	registerCmd(context, 'debug', debugDelphi);

	checkExtension('embarcaderotechnologies.delphilsp',
		'DelphiLSP provides language support and is recommended.',
		'Install DelphiLSP');
	checkExtension('tuncb.pascal-uses-formatter',
		'PascalUsesFormatter helps keep the `uses` section in alphabetical order.',
		'Install PascalUsesFormatter');
}

function registerCmd(context: vscode.ExtensionContext, cmdName: string, cmdCallback: (...args: any[]) => any) {
	context.subscriptions.push(vscode.commands.registerCommand(`${EXTENSION_NAME}.${cmdName}`, cmdCallback));
}

async function debugDelphi() {
	if (!fs.existsSync(MAP_PATCHER_PATH)) {
		vscode.window.showErrorMessage(`Unable to find MapPatcher.exe at ${MAP_PATCHER_PATH}.`);
		return;
	}
	
	if (!fs.existsSync(MAP2PDB_PATH)) {
		vscode.window.showErrorMessage(`Unable to find map2pdb.exe at ${MAP2PDB_PATH}.`);
		return;
	}

	await runMSBuildProcess([], 'Build Delphi');

	const dprojFilePath = await getDprojFilePath();
	if (!dprojFilePath) {
		return;
	}
	const exePath = await getExecutableFilePath(dprojFilePath);
	if (!exePath) {
		return;
	}

	const mapFilePath = exePath.replace(path.extname(exePath), '.map');
	const sourceDirs = [getConfigString('embarcaderoInstallDir'), path.dirname(dprojFilePath)];
	if (!sourceDirs) {
		return;
	}
	
	const args = [mapFilePath, ...sourceDirs];
	const mapPatcherProcess = childProcess.spawn(MAP_PATCHER_PATH, args);
	console.log('patching map');
	mapPatcherProcess.stdout.on('data', (data) => {
		console.log(data.toString());
	});

	mapPatcherProcess.stderr.on('data', (data) => {
		console.log(data.toString());
	});

	mapPatcherProcess.on('close', (code) => {
		console.log(`MapPatcher process exited with code ${code}`);
		if (code === 0) {
			vscode.window.showInformationMessage('.map patched!');
		}
	});

	// 3. Convert the .map file to .pdb using map2pdb.exe
	const map2pdbProcess = childProcess.spawn(MAP2PDB_PATH, ['-bind', mapFilePath]);
	console.log('converting map to pdb');
	map2pdbProcess.stdout.on('data', (data) => {
		console.log(data.toString());
	});

	map2pdbProcess.stderr.on('data', (data) => {
		console.log(data.toString());
	});

	map2pdbProcess.on('close', (code) => {
		console.log(`map2pdb process exited with code ${code}`);
		if (code === 0) {
			vscode.window.showInformationMessage('.map converted to .pdb!');
		}
	});

	runDebugger(exePath);
	vscode.window.showInformationMessage('Debugging Delphi is not yet implemented.');
}

async function runDebugger(exePath: string) {
	const debugConfigurations = vscode.workspace.getConfiguration('launch');
	const configurations: any[] = debugConfigurations.get('configurations') || [];
	const debugConfigName = 'Debug Deplhi';

	const newConfiguration = {
		name: `${debugConfigName}`,
		type: 'cppvsdbg',
		request: 'launch',
		program: `${exePath}`,
		args: [],
		stopAtEntry: false,
		cwd: "${workspaceFolder}",
		environment: [],
		console: "externalTerminal"
	};

	configurations.push(newConfiguration);

	await debugConfigurations.update('configurations', configurations);

	const workspaceFolder = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0] : undefined;
	if (workspaceFolder) {
	  const success = await vscode.debug.startDebugging(workspaceFolder, debugConfigName);
	  if (!success) {
		vscode.window.showErrorMessage('Failed to start debugger');
	  }
	} else {
	  vscode.window.showErrorMessage('No workspace folder open');
	}
}

function testDelphi() {
	const msg = `test ${EXTENSION_NAME} command.`;
	console.log(msg);
	vscode.window.showInformationMessage(msg);
}

async function buildDelphi() {
	await runMSBuildProcess([], 'Build Delphi');
}

async function runDelphi() {
	await runMSBuildProcess([], 'Run Delphi');
	const dprojFilePath = await getDprojFilePath();
	if (!dprojFilePath) {
		return;
	}

	const exePath = await getExecutableFilePath(dprojFilePath);
	fs.promises.access(exePath, fs.constants.X_OK)
		.then(() => vscode.env.openExternal(vscode.Uri.file(exePath)))
		.catch(() => vscode.window.showErrorMessage(`File does not exist: ${exePath}`));
}

async function cleanDelphi() {
	await runMSBuildProcess(['/t:Clean'], 'Clean Delphi');
}

async function runMSBuildProcess(extraArgs: readonly string[] = [], processName: string = 'MSBuild process'): Promise<void> {
	const rsvarsPath = getConfigString('rsvarsPath');
	if (!rsvarsPath) {
		return;
	}

	const dprojPath = await getDprojFilePath();
	if (!dprojPath) {
		return;
	}

	const outputChannel = vscode.window.createOutputChannel(processName);
	outputChannel.show();

	const args = ['/c', rsvarsPath, '&&', 'MSBuild', dprojPath, ...extraArgs];
	const buildProcess = childProcess.spawn('cmd.exe', args);
	buildProcess.stdout.on('data', (data) => {
		outputChannel.appendLine(data.toString());
	});

	buildProcess.stderr.on('data', (data) => {
		outputChannel.appendLine(data.toString());
	});

	return  new Promise((resolve, reject) => {
		buildProcess.on('close', (code) =>{
			outputChannel.appendLine(`Build process exited with code ${code}`);
			if (code === 0) {
				resolve();
			}
			else {
				reject();
			}
		});
	});
}

async function getExecutableFilePath(dprojFilePath: string): Promise<string> {
	const dprojContent = await fs.promises.readFile(dprojFilePath, 'utf8');
	const dprojXml = await xml2js.parseStringPromise(dprojContent);
	const propGroups = dprojXml.Project.PropertyGroup;
	for (const propGroup of propGroups) {
		if (!(propGroup.DCC_ExeOutput && propGroup.SanitizedProjectName)) {
			continue;
		}

		let relativeOutputDir: string = propGroup.DCC_ExeOutput[0];
		if (relativeOutputDir.includes('$(Platform)') && propGroups[0].Platform[0]) {
			relativeOutputDir = relativeOutputDir.replace('$(Platform)', propGroups[0].Platform[0]._);
		}
		if (relativeOutputDir.includes('$(Config)') && propGroups[0].Config[0]) {
			relativeOutputDir = relativeOutputDir.replace('$(Config)', propGroups[0].Config[0]._);
		}
		const projectName = propGroup.SanitizedProjectName[0];
		const exePath = path.join(path.dirname(dprojFilePath), relativeOutputDir, `${projectName}.exe`);
		return exePath;
	}

	vscode.window.showErrorMessage(`Unable to obtain output directory/executable name from ${dprojFilePath}.`);
	return '';
}

async function getDprojFilePath(): Promise<string | undefined> {
	const dprojFiles = await vscode.workspace.findFiles('**/*.dproj', '**/node_modules/**', 1);
	if (dprojFiles.length > 0) {
		return dprojFiles[0].fsPath;
	}

	vscode.window.showErrorMessage('No .dproj file found in the current workspace.');
	return undefined;
}

function getConfigString(propertyName: string): string {
	const config = vscode.workspace.getConfiguration(EXTENSION_NAME);
	if (!config) {
		vscode.window.showErrorMessage(`Unable to obtain ${EXTENSION_NAME} configuration.`);
		return '';
	}

	const prop = config.get(propertyName) as string;
	if (!prop) {
		vscode.window.showErrorMessage(`Unable to obtain ${propertyName} from config. Make sure it is set. (Ctrl + ,)`);
		return '';
	}

	return prop;
}

function checkExtension(extensionID: string, description: string, button: string) {
	if (!vscode.extensions.getExtension(extensionID)) {
		vscode.window.showInformationMessage(description, button)
			.then(selection => {
				if (selection === button) {
					vscode.commands.executeCommand('workbench.extensions.installExtension', extensionID);
				}
			});
	}
}

// This method is called when your extension is deactivated
export function deactivate() {}

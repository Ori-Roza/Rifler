import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface ProjectType {
    id: string;
    name: string;
    detectedBy: string;
    excludePatterns: string[];
    enabled: boolean;
}

export interface ProjectExclusions {
    detectedProjects: ProjectType[];
    suggestedExcludes: string[];
}

/**
 * Configuration for detecting different project types
 */
const PROJECT_TYPE_CONFIGS = [
    {
        id: 'nodejs',
        name: 'Node.js/JavaScript',
        markerFiles: ['package.json', 'yarn.lock', 'package-lock.json', 'pnpm-lock.yaml'],
        excludePatterns: ['node_modules/**', '.npm/**', '.yarn/**', 'dist/**', 'build/**']
    },
    {
        id: 'rust',
        name: 'Rust',
        markerFiles: ['Cargo.toml', 'Cargo.lock'],
        excludePatterns: ['target/**', 'Cargo.lock']
    },
    {
        id: 'python',
        name: 'Python',
        markerFiles: ['pyproject.toml', 'setup.py', 'requirements.txt', 'Pipfile', 'poetry.lock'],
        excludePatterns: ['venv/**', 'env/**', '.venv/**', '__pycache__/**', '.pytest_cache/**', '*.pyc', '.tox/**', 'dist/**', 'build/**', '*.egg-info/**']
    },
    {
        id: 'dotnet',
        name: '.NET',
        markerFiles: ['*.csproj', '*.fsproj', '*.vbproj', '*.sln'],
        excludePatterns: ['bin/**', 'obj/**', 'packages/**', '.vs/**']
    },
    {
        id: 'java',
        name: 'Java/Gradle/Maven',
        markerFiles: ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle'],
        excludePatterns: ['target/**', 'build/**', '.gradle/**', 'out/**']
    },
    {
        id: 'go',
        name: 'Go',
        markerFiles: ['go.mod', 'go.sum'],
        excludePatterns: ['vendor/**', 'bin/**']
    },
    {
        id: 'ruby',
        name: 'Ruby',
        markerFiles: ['Gemfile', 'Gemfile.lock', '*.gemspec'],
        excludePatterns: ['vendor/bundle/**', '.bundle/**', 'tmp/**']
    },
    {
        id: 'php',
        name: 'PHP',
        markerFiles: ['composer.json', 'composer.lock'],
        excludePatterns: ['vendor/**', 'storage/**']
    },
    {
        id: 'general',
        name: 'General',
        markerFiles: ['.git'],
        excludePatterns: ['.git/**', '.svn/**', '.hg/**', '.DS_Store', 'Thumbs.db']
    }
];

/**
 * Check if a file exists in any workspace folder
 */
async function fileExistsInWorkspace(fileName: string, workspaceFolders: readonly vscode.WorkspaceFolder[]): Promise<{ exists: boolean; folder?: vscode.WorkspaceFolder; matchedFile?: string }> {
    for (const folder of workspaceFolders) {
        // For patterns with wildcards, scan directory
        if (fileName.includes('*')) {
            const files = await vscode.workspace.fs.readDirectory(folder.uri);
            const pattern = new RegExp('^' + fileName.replace(/\*/g, '.*') + '$');
            const matched = files.find(([name]) => pattern.test(name));
            if (matched) {
                return { exists: true, folder, matchedFile: matched[0] };
            }
        } else {
            // Direct file check
            const filePath = path.join(folder.uri.fsPath, fileName);
            try {
                await fs.promises.access(filePath);
                return { exists: true, folder, matchedFile: fileName };
            } catch {
                // File doesn't exist, continue checking
            }
        }
    }
    return { exists: false };
}

/**
 * Detect project types in the workspace
 */
export async function detectProjectTypes(): Promise<ProjectExclusions> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return { detectedProjects: [], suggestedExcludes: [] };
    }

    const detectedProjects: ProjectType[] = [];
    const allExcludes = new Set<string>();

    // Check each project type configuration
    for (const config of PROJECT_TYPE_CONFIGS) {
        // Check if any marker file exists
        for (const markerFile of config.markerFiles) {
            const result = await fileExistsInWorkspace(markerFile, workspaceFolders);
            if (result.exists) {
                detectedProjects.push({
                    id: config.id,
                    name: config.name,
                    detectedBy: result.matchedFile || markerFile,
                    excludePatterns: config.excludePatterns,
                    enabled: true // Default to enabled
                });
                
                // Add patterns to the set
                config.excludePatterns.forEach(pattern => allExcludes.add(pattern));
                break; // Found marker, no need to check other markers for this type
            }
        }
    }

    return {
        detectedProjects,
        suggestedExcludes: Array.from(allExcludes)
    };
}

/**
 * Build exclude patterns string for search
 */
export function buildExcludePatterns(enabledProjects: ProjectType[]): string {
    const patterns: string[] = [];
    
    for (const project of enabledProjects) {
        if (project.enabled) {
            patterns.push(...project.excludePatterns);
        }
    }
    
    // Remove duplicates and return as comma-separated string
    return Array.from(new Set(patterns))
        .map(pattern => `!${pattern}`)
        .join(',');
}

/**
 * Merge user file masks with exclusion patterns
 */
export function mergeFileMasks(userFileMask: string, exclusionPatterns: string): string {
    if (!exclusionPatterns) {
        return userFileMask;
    }
    
    if (!userFileMask || userFileMask.trim() === '') {
        return exclusionPatterns;
    }
    
    // Combine user mask and exclusions
    return `${userFileMask},${exclusionPatterns}`;
}

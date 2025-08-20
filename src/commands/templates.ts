import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

export class TemplatesCommand {
  private templatesDir: string;

  constructor() {
    this.templatesDir = path.join(__dirname, '../../templates');
  }

  async execute(): Promise<void> {
    console.log(chalk.cyan('📦 Available templates:\n'));

    if (!fs.existsSync(this.templatesDir)) {
      console.log(chalk.yellow('No templates directory found'));
      return;
    }

    const entries = fs.readdirSync(this.templatesDir, { withFileTypes: true });
    const templates: { name: string; type: 'bundle' | 'hook'; description: string; hooks?: string[] }[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        // Bundle - directory with multiple hooks
        const bundlePath = path.join(this.templatesDir, entry.name);
        const hookFiles = fs.readdirSync(bundlePath)
          .filter(f => f.endsWith('.json'))
          .sort();

        if (hookFiles.length > 0) {
          const hooks: string[] = [];
          let bundleDescription = '';

          // Read hooks to get names and description
          try {
            for (const file of hookFiles) {
              const content = fs.readFileSync(path.join(bundlePath, file), 'utf-8');
              const hook = JSON.parse(content);
              hooks.push(hook.name || file.replace('.json', ''));
            }

            // Create bundle description based on actual content
            bundleDescription = this.getBundleDescription(entry.name, hooks);
          } catch (error) {
            bundleDescription = `Bundle with ${hookFiles.length} hooks (error reading)`;
          }

          templates.push({
            name: entry.name,
            type: 'bundle',
            description: bundleDescription,
            hooks
          });
        }
      } else if (entry.name.endsWith('.json')) {
        // Single hook template
        const templatePath = path.join(this.templatesDir, entry.name);
        try {
          const content = fs.readFileSync(templatePath, 'utf-8');
          const hook = JSON.parse(content);
          
          templates.push({
            name: entry.name.replace('.json', ''),
            type: 'hook',
            description: hook.description || 'No description'
          });
        } catch (error) {
          templates.push({
            name: entry.name.replace('.json', ''),
            type: 'hook',
            description: 'Error reading template'
          });
        }
      }
    }

    if (templates.length === 0) {
      console.log(chalk.yellow('No templates found'));
      return;
    }

    // Display bundles first
    const bundles = templates.filter(t => t.type === 'bundle');
    const hooks = templates.filter(t => t.type === 'hook');

    if (bundles.length > 0) {
      console.log(chalk.bold('Template Bundles') + chalk.gray(' (install multiple related hooks):\n'));
      for (const bundle of bundles) {
        console.log(chalk.green(`  ${bundle.name}`) + chalk.gray(` - ${bundle.description}`));
        if (bundle.hooks && bundle.hooks.length > 0) {
          const hookList = bundle.hooks.slice(0, 5).join(', ');
          const more = bundle.hooks.length > 5 ? `, +${bundle.hooks.length - 5} more` : '';
          console.log(chalk.gray(`    Includes: ${hookList}${more}`));
        }
        console.log();
      }
    }

    if (hooks.length > 0) {
      console.log(chalk.bold('Individual Templates:\n'));
      for (const hook of hooks) {
        console.log(chalk.green(`  ${hook.name}`) + chalk.gray(` - ${hook.description}`));
      }
      console.log();
    }

    console.log(chalk.gray('To install: ') + chalk.white('cc-hooks install <template-name>'));
    console.log(chalk.gray('To see your installed hooks: ') + chalk.white('cc-hooks show'));
  }

  private getBundleDescription(bundleName: string, hooks: string[]): string {
    // Provide meaningful descriptions for known bundles
    switch (bundleName) {
      case 'typescript':
        return 'Complete TypeScript development suite';
      case 'python':
        return 'Python linting and formatting tools';
      case 'rust':
        return 'Rust development and testing hooks';
      default:
        return `Bundle with ${hooks.length} hooks`;
    }
  }
}
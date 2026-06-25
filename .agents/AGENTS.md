# Project Customizations: BabyGuard / iomt-lab

This directory defines workspace-specific customizations (Rules and Skills) for Google Antigravity agents working in this repository.

## 📋 General Rules & Guidelines

- **Lingua / Language**: Rispondi sempre in italiano, scrivi i commenti nel codice in italiano e configura i log in italiano.
- **Code Quality**: Follow standard Python, JavaScript/Node.js, and Android development guidelines.
- **Maintain Documentation Integrity**: Preserve all existing comments and docstrings when editing files unless requested otherwise.
- **Project Structure**: Respect the directory organization:
  - `backend/`: Server-side logic and services.
  - `mobile/`: Android/Mobile application code.
  - `nodered/`: Node-RED flows and integrations.
  - `influxdb/` & `grafana/`: Data storage and visualization settings.

## 🛠️ Custom Agent Skills

Place specialized agent skill folders in the `.agents/skills/` directory. Each skill folder must contain a `SKILL.md` file specifying YAML frontmatter with `name` and `description`.
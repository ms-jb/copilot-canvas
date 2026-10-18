import { isPlainObject, onlyKeys } from "./validation.mjs";
/** Caps on GET api/skills so one odd skill directory can't flood the page. */
export const SKILL_LIMITS = Object.freeze({
    maxSkills: 300,
    maxName: 80,
    maxDescription: 300,
    maxHint: 120,
});
/** A slash-command name as the session lists it: plugin skills read `plugin:name`. */
export const SKILL_NAME = /^[A-Za-z0-9_.:-]+$/;
const textWithin = (value, max) => typeof value === "string" && value.length <= max && !/[\p{Cc}\p{Cf}]/u.test(value);
export function isSkillName(value) {
    return (typeof value === "string" && value.length <= SKILL_LIMITS.maxName && SKILL_NAME.test(value));
}
export function validateSkills(value) {
    if (!isPlainObject(value) ||
        !onlyKeys(value, ["available", "skills"]) ||
        typeof value.available !== "boolean" ||
        !Array.isArray(value.skills) ||
        value.skills.length > SKILL_LIMITS.maxSkills ||
        (!value.available && value.skills.length > 0)) {
        return false;
    }
    const names = new Set();
    return value.skills.every((skill) => {
        if (!isPlainObject(skill) ||
            !onlyKeys(skill, ["name", "description", "hint"]) ||
            !isSkillName(skill.name) ||
            names.has(skill.name.toLowerCase()) ||
            !textWithin(skill.description, SKILL_LIMITS.maxDescription) ||
            !(skill.hint === null || textWithin(skill.hint, SKILL_LIMITS.maxHint))) {
            return false;
        }
        names.add(skill.name.toLowerCase());
        return true;
    });
}
/** `/name rest` split into the command name and its input, as the Copilot CLI reads a draft. */
export function parseSlashCommand(text) {
    const match = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
    if (!match?.[1] || !isSkillName(match[1]))
        return null;
    return { name: match[1], input: (match[2] ?? "").trim() };
}

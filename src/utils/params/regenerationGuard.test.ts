import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import modelText from '../../components/ImperativeModel.tsx?raw';
import viewerText from '../../components/ModelViewer.tsx?raw';
import { geometryDescriptors } from '../../components/params/descriptors/geometry';

// Vite supplies source text without importing the components or needing node:fs.
// Parse only syntax: comments, similarly named props and unrelated effects must
// not satisfy a missing wire.
function descendants(node: ts.Node): ts.Node[] {
    const nodes = [node];
    node.forEachChild(child => { nodes.push(...descendants(child)); });
    return nodes;
}

function isSetting(expression: ts.Expression, key: string, locals: string[]): boolean {
    return (ts.isIdentifier(expression) && locals.includes(expression.text)) ||
        (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) &&
            expression.expression.text === 'geometrySettings' && expression.name.text === key);
}

// A mention buried in an unrelated expression is not a forward. Only the two
// existing optional numeric fields perform the empty-string/Number conversion.
function isForward(expression: ts.Expression, key: string, locals: string[]): boolean {
    if (isSetting(expression, key, locals)) return true;
    if (!['patternScaleZ', 'patternMaxHeight'].includes(key) || !ts.isConditionalExpression(expression)) return false;
    const { condition, whenTrue, whenFalse } = expression;
    return ts.isBinaryExpression(condition) && condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
        isSetting(condition.left, key, locals) && ts.isStringLiteral(condition.right) && condition.right.text === '' &&
        ts.isIdentifier(whenTrue) && whenTrue.text === 'undefined' &&
        ts.isCallExpression(whenFalse) && ts.isIdentifier(whenFalse.expression) && whenFalse.expression.text === 'Number' &&
        whenFalse.arguments.length === 1 && isSetting(whenFalse.arguments[0], key, locals);
}

const model = ts.createSourceFile('ImperativeModel.tsx', modelText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const viewer = ts.createSourceFile('ModelViewer.tsx', viewerText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const modelNodes = descendants(model);
const viewerNodes = descendants(viewer);
const anchor = '// NOTE: patternColor and wireframePattern are intentionally NOT dependencies';
const anchorPosition = modelText.indexOf(anchor);
const effect = modelNodes.filter(ts.isCallExpression).find(call =>
    ts.isIdentifier(call.expression) && call.expression.text === 'useEffect' &&
    call.getStart(model) < anchorPosition && call.getEnd() > anchorPosition);
const dependencies = effect?.arguments[1];
const props = modelNodes.filter(ts.isInterfaceDeclaration).find(node => node.name.text === 'ImperativeModelProps');
const bindings = viewerNodes.filter(ts.isVariableDeclaration).filter(node =>
    ts.isObjectBindingPattern(node.name) && node.initializer &&
    ts.isIdentifier(node.initializer) && node.initializer.text === 'geometrySettings');
const models = viewerNodes.filter(node => ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node))
    .filter(node => ts.isIdentifier(node.tagName) && node.tagName.text === 'ImperativeModel');

describe('T7: every regenerating geometry descriptor reaches the model effect', () => {
    it.each(geometryDescriptors.filter(descriptor => descriptor.regenerates))('$key', ({ key }) => {
        expect(anchorPosition, 'dependency anchor must exist exactly once').toBeGreaterThanOrEqual(0);
        expect(modelText.indexOf(anchor, anchorPosition + anchor.length)).toBe(-1);
        expect(dependencies && ts.isArrayLiteralExpression(dependencies), 'anchored effect must have a literal dependency array').toBe(true);
        if (!dependencies || !ts.isArrayLiteralExpression(dependencies)) throw new Error('Missing dependency array');
        expect(dependencies.getStart(model)).toBeGreaterThan(anchorPosition);
        expect(dependencies.elements.some(element => ts.isIdentifier(element) && element.text === key),
            '(a) ' + key + ' must occur in the anchored dependency array').toBe(true);

        expect(props?.members.some(member => ts.isPropertySignature(member) &&
            ts.isIdentifier(member.name) && member.name.text === key),
            '(b) ' + key + ' must be declared in ImperativeModelProps').toBe(true);

        expect(models.length, 'the single ImperativeModel JSX must exist').toBe(1);
        const locals = bindings.flatMap(binding => ts.isObjectBindingPattern(binding.name)
            ? binding.name.elements.filter(element => !element.dotDotDotToken &&
                (element.propertyName ?? element.name).getText(viewer) === key &&
                ts.isIdentifier(element.name)).map(element => element.name.getText(viewer))
            : []);
        for (const modelElement of models) {
            const attribute = modelElement.attributes.properties.find(property =>
                ts.isJsxAttribute(property) && ts.isIdentifier(property.name) && property.name.text === key);
            const initializer = attribute && ts.isJsxAttribute(attribute) ? attribute.initializer : undefined;
            const expression = initializer && ts.isJsxExpression(initializer) ? initializer.expression : undefined;
            if (['baseRotation', 'patternMaxHeight'].includes(key)) {
                expect(locals, key + ' must be destructured from geometrySettings').toEqual([key]);
                expect(expression?.getText(viewer), key + ' must preserve its existing value semantics').toBe(
                    key === 'baseRotation' ? 'baseRotation' : "patternMaxHeight === '' ? undefined : Number(patternMaxHeight)");
            }
            const derived = expression && isForward(expression, key, locals);
            expect(Boolean(derived), '(c) ' + key + ' must be forwarded from geometrySettings as its own JSX attribute').toBe(true);
        }
    });
});

describe('T7: forward expression guard rejects misleading mentions', () => {
    it.each([
        ['baseRotation', 'baseRotation', true],
        ['baseRotation', 'geometrySettings.baseRotation', true],
        ['patternMaxHeight', "patternMaxHeight === '' ? undefined : Number(patternMaxHeight)", true],
        ['patternMaxHeight', "geometrySettings.patternMaxHeight === '' ? undefined : Number(geometrySettings.patternMaxHeight)", true],
        ['baseRotation', '0', false],
        ['baseRotation', 'rotationClamp', false],
        ['baseRotation', '(baseRotation, 0)', false],
        ['baseRotation', 'false ? baseRotation : 0', false],
        ['baseRotation', 'baseRotation + 1', false],
        ['baseRotation', 'other.baseRotation', false],
        ['patternMaxHeight', "patternMaxHeight === '' ? undefined : Number(patternScaleZ)", false],
        ['patternMaxHeight', "patternMaxHeight === '' ? 0 : Number(patternMaxHeight)", false],
        ['patternMaxHeight', "patternMaxHeight === '' ? undefined : Number(patternMaxHeight + 1)", false],
    ] as const)('%s forwarded as %s: %s', (key, source, expected) => {
        const fixture = ts.createSourceFile('fixture.ts', `const value = ${source};`, ts.ScriptTarget.Latest, true);
        const expression = descendants(fixture).filter(ts.isVariableDeclaration)[0].initializer!;
        expect(isForward(expression, key, [key])).toBe(expected);
    });
});

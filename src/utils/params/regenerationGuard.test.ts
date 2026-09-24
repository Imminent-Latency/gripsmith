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

        expect(models.length, 'ImperativeModel JSX must exist').toBeGreaterThan(0);
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
            // Both destructured forwards and the pre-existing baseRotation /
            // patternMaxHeight geometrySettings.<key> expressions are valid.
            const derived = expression && descendants(expression).some(node =>
                (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) &&
                    node.expression.text === 'geometrySettings' && node.name.text === key) ||
                (ts.isIdentifier(node) && locals.includes(node.text) &&
                    !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)));
            expect(Boolean(derived), '(c) ' + key + ' must be forwarded from geometrySettings as its own JSX attribute').toBe(true);
        }
    });
});

import assert from 'assert';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { StepMap, Mapping } from 'prosemirror-transform';
import { Node as PmNode } from 'prosemirror-model';
import { doc, p, blockquote } from 'prosemirror-test-builder';

type DecorationSetTestCase = { afterDoc: any, actionMapping: Mapping, undoMapping: Mapping };
describe('Decoration Set maps consistently with inserts', () => {
    const block1 = blockquote(p('Lorem <s1>ipsum<e1>'));
    const block2 = blockquote(p('dolor sit amet,'));
    const block3 = blockquote(p('consectetur adipiscing elit,'));
    const block4 = blockquote(p('sed do <s2>eiusmod<e2> tempor incididunt'));
    const block5 = blockquote(p('ut labore et <s3>dolore<e3> magna aliqua.'));

    const beforeDoc = doc(
        block1,
        block2,
        block3,
        block4,
        block5
    ) as any;

    /** Get the set of expected decorations in the provided doc */
    const getDecorations = (docWithDecos: any) => {
        return DecorationSet.create(docWithDecos, [
            Decoration.inline(docWithDecos.tag.s1, docWithDecos.tag.e1, {}),
            Decoration.inline(docWithDecos.tag.s2, docWithDecos.tag.e2, {}),
            Decoration.inline(docWithDecos.tag.s3, docWithDecos.tag.e3, {})
        ]);
    };

    const beforeDecorationSet = getDecorations(beforeDoc);

    /** Gets the node size of the new block associated with the provided tag */
    const getNodeSizeFor = (afterDoc: PmNode, tag: string) => {
        return afterDoc.resolve((afterDoc as any).tag[`${tag}`]).nodeAfter!.nodeSize;
    };

    /** Build the set of test cases */
    const testCases = [] as DecorationSetTestCase[];

    // Test Case 0
    const afterDoc0 = doc(
        '<a0>', blockquote(p('test')),
        '<a1>', blockquote(p('hello')),
        block1,
        '<a2>', blockquote(p('test')),
        '<a3>', blockquote(p('hello')),
        block2,
        '<a4>', blockquote(p('test')),
        '<a5>', blockquote(p('hello')),
        block3,
        '<a6>', blockquote(p('test')),
        '<a7>', blockquote(p('hello')),
        block4,
        '<a8>', blockquote(p('test')),
        '<a9>', blockquote(p('hello')),
        block5
    ) as any;
    testCases.push({
        afterDoc: afterDoc0,
        actionMapping: new Mapping([
            new StepMap([afterDoc0.tag.a0, 0, getNodeSizeFor(afterDoc0, 'a0')]),
            new StepMap([afterDoc0.tag.a1, 0, getNodeSizeFor(afterDoc0, 'a1')]),
            new StepMap([afterDoc0.tag.a2, 0, getNodeSizeFor(afterDoc0, 'a2')]),
            new StepMap([afterDoc0.tag.a3, 0, getNodeSizeFor(afterDoc0, 'a3')]),
            new StepMap([afterDoc0.tag.a4, 0, getNodeSizeFor(afterDoc0, 'a4')]),
            new StepMap([afterDoc0.tag.a5, 0, getNodeSizeFor(afterDoc0, 'a5')]),
            new StepMap([afterDoc0.tag.a6, 0, getNodeSizeFor(afterDoc0, 'a6')]),
            new StepMap([afterDoc0.tag.a7, 0, getNodeSizeFor(afterDoc0, 'a7')]),
            new StepMap([afterDoc0.tag.a8, 0, getNodeSizeFor(afterDoc0, 'a8')]),
            new StepMap([afterDoc0.tag.a9, 0, getNodeSizeFor(afterDoc0, 'a9')])
        ]),
        undoMapping: new Mapping([
            new StepMap([afterDoc0.tag.a8, getNodeSizeFor(afterDoc0, 'a8') + getNodeSizeFor(afterDoc0, 'a9'), 0]),
            new StepMap([afterDoc0.tag.a6, getNodeSizeFor(afterDoc0, 'a6') + getNodeSizeFor(afterDoc0, 'a7'), 0]),
            new StepMap([afterDoc0.tag.a4, getNodeSizeFor(afterDoc0, 'a4') + getNodeSizeFor(afterDoc0, 'a5'), 0]),
            new StepMap([afterDoc0.tag.a2, getNodeSizeFor(afterDoc0, 'a2') + getNodeSizeFor(afterDoc0, 'a3'), 0]),
            new StepMap([afterDoc0.tag.a0, getNodeSizeFor(afterDoc0, 'a0') + getNodeSizeFor(afterDoc0, 'a1'), 0])
        ])
    });

    // Test Case 1
    const afterDoc1 = doc(
        '<a0>', blockquote(p('test')),
        '<a1>', blockquote(p('hello')),
        block1,
        block2,
        block3,
        '<a2>', blockquote(p('test')),
        '<a3>', blockquote(p('hello')),
        block4,
        '<a4>', blockquote(p('test')),
        '<a5>', blockquote(p('hello')),
        block5
    ) as any;
    testCases.push({
        afterDoc: afterDoc1,
        actionMapping: new Mapping([
            new StepMap([afterDoc1.tag.a0, 0, getNodeSizeFor(afterDoc1, 'a0')]),
            new StepMap([afterDoc1.tag.a1, 0, getNodeSizeFor(afterDoc1, 'a1')]),
            new StepMap([afterDoc1.tag.a2, 0, getNodeSizeFor(afterDoc1, 'a2')]),
            new StepMap([afterDoc1.tag.a3, 0, getNodeSizeFor(afterDoc1, 'a3')]),
            new StepMap([afterDoc1.tag.a4, 0, getNodeSizeFor(afterDoc1, 'a4')]),
            new StepMap([afterDoc1.tag.a5, 0, getNodeSizeFor(afterDoc1, 'a5')])
        ]),
        undoMapping: new Mapping([
            new StepMap([afterDoc1.tag.a4, getNodeSizeFor(afterDoc1, 'a4') + getNodeSizeFor(afterDoc1, 'a5'), 0]),
            new StepMap([afterDoc1.tag.a2, getNodeSizeFor(afterDoc1, 'a2') + getNodeSizeFor(afterDoc1, 'a3'), 0]),
            new StepMap([afterDoc1.tag.a0, getNodeSizeFor(afterDoc1, 'a0') + getNodeSizeFor(afterDoc1, 'a1'), 0])
        ])
    });

    // Test Case 2
    const afterDoc2 = doc(
        '<a0>', blockquote(p('test')),
        '<a1>', blockquote(p('hello')),
        block1,
        '<a2>', blockquote(p('test')),
        '<a3>', blockquote(p('hello')),
        block2,
        block3,
        block4,
        '<a4>', blockquote(p('test')),
        '<a5>', blockquote(p('hello')),
        block5
    ) as any;
    testCases.push({
        afterDoc: afterDoc2,
        actionMapping: new Mapping([
            new StepMap([afterDoc2.tag.a0, 0, getNodeSizeFor(afterDoc2, 'a0')]),
            new StepMap([afterDoc2.tag.a1, 0, getNodeSizeFor(afterDoc2, 'a1')]),
            new StepMap([afterDoc2.tag.a2, 0, getNodeSizeFor(afterDoc2, 'a2')]),
            new StepMap([afterDoc2.tag.a3, 0, getNodeSizeFor(afterDoc2, 'a3')]),
            new StepMap([afterDoc2.tag.a4, 0, getNodeSizeFor(afterDoc2, 'a4')]),
            new StepMap([afterDoc2.tag.a5, 0, getNodeSizeFor(afterDoc2, 'a5')])
        ]),
        undoMapping: new Mapping([
            new StepMap([afterDoc2.tag.a4, getNodeSizeFor(afterDoc2, 'a4') + getNodeSizeFor(afterDoc2, 'a5'), 0]),
            new StepMap([afterDoc2.tag.a2, getNodeSizeFor(afterDoc2, 'a2') + getNodeSizeFor(afterDoc2, 'a3'), 0]),
            new StepMap([afterDoc2.tag.a0, getNodeSizeFor(afterDoc2, 'a0') + getNodeSizeFor(afterDoc2, 'a1'), 0])
        ])
    });

    // Test Case 3
    const afterDoc3 = doc(
        block1,
        block2,
        '<a0>', blockquote(p('hello')),
        block3,
        '<a1>', blockquote(p('hello')),
        block4,
        '<a2>', blockquote(p('hello')),
        block5
    ) as any;
    testCases.push({
        afterDoc: afterDoc3,
        actionMapping: new Mapping([
            new StepMap([afterDoc3.tag.a0, 0, getNodeSizeFor(afterDoc3, 'a0')]),
            new StepMap([afterDoc3.tag.a1, 0, getNodeSizeFor(afterDoc3, 'a1')]),
            new StepMap([afterDoc3.tag.a2, 0, getNodeSizeFor(afterDoc3, 'a2')])
        ]),
        undoMapping: new Mapping([
            new StepMap([afterDoc3.tag.a4, getNodeSizeFor(afterDoc3, 'a2'), 0]),
            new StepMap([afterDoc3.tag.a2, getNodeSizeFor(afterDoc3, 'a1'), 0]),
            new StepMap([afterDoc3.tag.a0, getNodeSizeFor(afterDoc3, 'a0'), 0])
        ])
    });

    testCases.forEach(({ afterDoc, actionMapping, undoMapping}: DecorationSetTestCase, i: number) => {
        it(`on action (test case ${i})`, () => {
            const expectedAfterActionDecos = getDecorations(afterDoc);

            let afterActionSet = beforeDecorationSet.map(actionMapping, afterDoc);
            assert.deepEqual(afterActionSet.find(), expectedAfterActionDecos.find());
        });

        it(`on undo (test case ${i})`, () => {
            const afterActionSet = getDecorations(afterDoc);

            let afterUndoSet = afterActionSet.map(undoMapping, beforeDoc);
            assert.deepEqual(afterUndoSet.find(), beforeDecorationSet.find());
        });

        it(`on action and undo (test case ${i})`, () => {
            const expectedAfterActionDecos = getDecorations(afterDoc);

            // Act 1 - apply action
            let afterActionSet = beforeDecorationSet.map(actionMapping, afterDoc);
            assert.deepEqual(afterActionSet.find(), expectedAfterActionDecos.find());

            // Act 2 - apply undo
            let afterUndoSet = afterActionSet.map(undoMapping, beforeDoc);
            assert.deepEqual(afterUndoSet.find(), beforeDecorationSet.find());
        });
    });
});
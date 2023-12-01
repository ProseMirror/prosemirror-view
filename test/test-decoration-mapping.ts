import assert from 'assert';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { Transform } from 'prosemirror-transform';
import { Node as PmNode } from 'prosemirror-model';
import { doc, p, blockquote } from 'prosemirror-test-builder';

type DecorationSetTestCase = { afterActionDecos: DecorationSet, actionTr: Transform };
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

    /** Build the set of test cases */
    const testCases = [] as DecorationSetTestCase[];

    // Test Case 0
    const afterDoc0 = doc(
        '<a0>', blockquote(p('test')),
        block1,
        '<a1>', blockquote(p('test')),
        block2,
        '<a2>', blockquote(p('test')),
        block3,
        '<a3>', blockquote(p('test')),
        block4,
        '<a4>', blockquote(p('test')),
        block5
    ) as any;
    const actionTr = new Transform(beforeDoc);
    actionTr.insert(afterDoc0.tag.a0, blockquote(p('test')));
    actionTr.insert(afterDoc0.tag.a1, blockquote(p('test')));
    actionTr.insert(afterDoc0.tag.a2, blockquote(p('test')));
    actionTr.insert(afterDoc0.tag.a3, blockquote(p('test')));
    actionTr.insert(afterDoc0.tag.a4, blockquote(p('test')));
    testCases.push({ afterActionDecos: getDecorations(afterDoc0), actionTr });

    // Test Case 1
    const afterDoc1 = doc(
        '<a0>', blockquote(p('test')),
        block1,
        block2,
        block3,
        '<a1>', blockquote(p('test')),
        block4,
        '<a2>', blockquote(p('test')),
        block5
    ) as any;
    var actionTr1 = new Transform(beforeDoc);
    actionTr1.insert(afterDoc1.tag.a0, blockquote(p('test')));
    actionTr1.insert(afterDoc1.tag.a1, blockquote(p('test')));
    actionTr1.insert(afterDoc1.tag.a2, blockquote(p('test')));
    testCases.push({ afterActionDecos: getDecorations(afterDoc1), actionTr: actionTr1 });

    // Test Case 2
    const afterDoc2 = doc(
        '<a0>', blockquote(p('test')),
        block1,
        '<a1>', blockquote(p('test')),
        block2,
        block3,
        block4,
        '<a2>', blockquote(p('test')),
        block5
    ) as any;
    var actionTr2 = new Transform(beforeDoc);
    actionTr2.insert(afterDoc2.tag.a0, blockquote(p('test')));
    actionTr2.insert(afterDoc2.tag.a1, blockquote(p('test')));
    actionTr2.insert(afterDoc2.tag.a2, blockquote(p('test')));
    testCases.push({ afterActionDecos: getDecorations(afterDoc2), actionTr: actionTr2 });

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
    const actionTr3 = new Transform(beforeDoc);
    actionTr3.insert(afterDoc3.tag.a0, blockquote(p('hello')));
    actionTr3.insert(afterDoc3.tag.a1, blockquote(p('hello')));
    actionTr3.insert(afterDoc3.tag.a2, blockquote(p('hello')));
    testCases.push({ afterActionDecos: getDecorations(afterDoc3), actionTr: actionTr3 });

    testCases.forEach(({ afterActionDecos, actionTr }: DecorationSetTestCase, i: number) => {
        it(`on action (test case ${i})`, () => {

            let afterActionSet = beforeDecorationSet.map(actionTr.mapping, actionTr.doc);
            assert.deepEqual(afterActionSet.find(), afterActionDecos.find());
        });

        it(`on undo (test case ${i})`, () => {
            let afterUndoSet = afterActionDecos.map(actionTr.mapping.invert(), beforeDoc);
            assert.deepEqual(afterUndoSet.find(), beforeDecorationSet.find());
        });

        it(`on action and undo (test case ${i})`, () => {
            // Act 1 - apply action
            let afterActionSet = beforeDecorationSet.map(actionTr.mapping, actionTr.doc);
            assert.deepEqual(afterActionSet.find(), afterActionDecos.find());

            // Act 2 - apply undo
            let afterUndoSet = afterActionSet.map(actionTr.mapping.invert(), beforeDoc);
            assert.deepEqual(afterUndoSet.find(), beforeDecorationSet.find());
        });
    });
});
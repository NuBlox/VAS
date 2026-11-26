#!/usr/bin/env node
/**
 * Repeatable, metadata-only acceptance scenario. Uses the same project,
 * component, template, binding and workflow authoring primitives as the editor.
 * It never modifies generated Svelte source or connects to a database.
 */
import { writeFile } from 'node:fs/promises';
import {
  createProject, createComponent, saveComponentTemplate, insertLinkedTemplate,
  exposeTemplateInput, exposeTemplateSlot, setLinkedInput, bindLinkedInput,
  appendLinkedSlotNode, updateLinkedSlotNode, validateProject, walkNodes
} from '../src/lib/studio/model.js';
import { createStep, createActionDefinition } from '../src/lib/studio/workflow.js';
import { preferredDisplayField } from '../src/lib/studio/references.js';

export function createAcceptanceProject() {
  const project = createProject();
  project.id = 'app_customer_order_acceptance';
  project.name = 'Customer and Order Desk';
  const [customerModel, orderModel] = project.models;
  customerModel.table = 'vas_acceptance_customers';
  orderModel.table = 'vas_acceptance_orders';

  const [customers, orders] = project.pages;
  Object.assign(customers, { name:'Customers', path:'/customers', components:[] });
  Object.assign(orders, { name:'Orders', path:'/orders', components:[] });

  function control(type, id, patch) {
    const node = createComponent(type, id);
    Object.assign(node.props, patch);
    return node;
  }
  function input(id, label, field, model, fieldName) {
    const definition = model.fields.find(item => item.name === fieldName);
    if (!definition) throw Error(`Unknown field ${fieldName}`);
    return control('input',id,{label,field,required:definition.required,
      bindingModelId:model.id,bindingFieldId:definition.id});
  }
  function reference(id,label,field,model,fieldName) {
    const definition=model.fields.find(item=>item.name===fieldName);
    const target=project.models.find(item=>item.id===definition.referenceModelId);
    return control('select',id,{label,field,options:'',required:definition.required,
      bindingModelId:model.id,bindingFieldId:definition.id,referenceDisplayFieldId:preferredDisplayField(target)});
  }
  function button(id, text, model, action='submit') {
    return control('button',id,{text,action,bindingModelId:model.id});
  }
  function table(id, title, model, columns) {
    return control('table',id,{title,bindingModelId:model.id,columns});
  }
  function section(id,title,children) {
    const node=control('section',id,{title});node.children=children;return node;
  }

  const master=section('acceptance_customer_form_master','Customer editor',[
    input('acceptance_customer_name_master','Customer name','name',customerModel,'name'),
    input('acceptance_customer_email_master','Email address','email',customerModel,'email'),
    control('card','acceptance_customer_current_master',{title:'Form preview',body:'Enter a customer name.'}),
    button('acceptance_customer_save_master','Create customer',customerModel),
    button('acceptance_customer_edit_master','Update selected customer',customerModel),
    table('acceptance_customer_list_master','Customer records',customerModel,'id,name,email'),
    section('acceptance_customer_help_master','Instructions',[])
  ]);
  const template=saveComponentTemplate(project,master,'Reusable customer form and list','template_acceptance_customer_form');
  exposeTemplateInput(project,template.id,template.node.id,'title','panel_title');
  exposeTemplateInput(project,template.id,template.node.children[0].id,'label','name_label');
  exposeTemplateInput(project,template.id,template.node.children[2].id,'body','current_name');
  exposeTemplateSlot(project,template.id,template.node.children.at(-1).id,'instructions');

  const customerPanel=insertLinkedTemplate(project,template.id,customers.id);
  setLinkedInput(project,customers.id,customerPanel.id,'panel_title','Customer registration and editing');
  bindLinkedInput(project,customers.id,customerPanel.id,'current_name',{source:'form',field:'name'});
  const customerHelp=appendLinkedSlotNode(project,customers.id,customerPanel.id,'instructions','card');
  updateLinkedSlotNode(project,customers.id,customerPanel.id,'instructions',customerHelp.id,
    {title:'Select a customer to edit',body:'Save a new customer or select a row to update its details.'});
  customers.components.unshift(control('heading','acceptance_customer_heading',{text:'Customers',level:1}));

  const orderPanel=insertLinkedTemplate(project,template.id,orders.id);
  setLinkedInput(project,orders.id,orderPanel.id,'panel_title','Customer lookup and registration');
  setLinkedInput(project,orders.id,orderPanel.id,'name_label','Customer full name');
  setLinkedInput(project,orders.id,orderPanel.id,'current_name','Choose a customer from the searchable relationship picker below.');
  const orderHelp=appendLinkedSlotNode(project,orders.id,orderPanel.id,'instructions','card');
  updateLinkedSlotNode(project,orders.id,orderPanel.id,'instructions',orderHelp.id,
    {title:'Reference a customer',body:'Search customer names, then select a record to link to this order.'});
  orders.components.unshift(control('heading','acceptance_orders_heading',{text:'Orders',level:1}));
  orders.components.push(section('acceptance_order_section','Order editor',[
    input('acceptance_order_name','Order name','order_name',orderModel,'name'),
    reference('acceptance_order_customer','Customer','customer_id',orderModel,'customer_id'),
    input('acceptance_order_amount','Amount','amount',orderModel,'amount'),
    button('acceptance_order_save','Create order',orderModel),
    button('acceptance_order_edit','Update selected order',orderModel),
    button('acceptance_order_delete','Delete selected order (administrator)',orderModel),
    table('acceptance_order_list','Orders',orderModel,'id,name,customer_id,amount')
  ]));

  const notification=createActionDefinition('Show saved name','action_acceptance_notify');
  project.actions.push(notification);
  function idsIn(root) {
    const out={};walkNodes([root],node=>{if(node.type==='button')out[node.props.text]=node.id;});return out;
  }
  const customerButtons=[{page:customers,root:customerPanel},{page:orders,root:orderPanel}];
  for(const {page,root} of customerButtons) {
    const buttons=idsIn(root);
    const prefix=page.id==='page_dashboard'?'customers':'orders_customer';
    const flowCreate={id:`workflow_acceptance_${prefix}_create`,name:'Validate and create customer',
      trigger:{pageId:page.id,componentId:buttons['Create customer'],event:'click'},
      startStepId:`${prefix}_name_check`,steps:[
        createStep('condition',`${prefix}_name_check`,{field:'name',operator:'filled',trueId:`${prefix}_email_check`,falseId:`${prefix}_name_missing`}),
        createStep('condition',`${prefix}_email_check`,{field:'email',operator:'filled',trueId:`${prefix}_create`,falseId:`${prefix}_email_missing`}),
        createStep('create',`${prefix}_create`,{modelId:customerModel.id,nextId:`${prefix}_notify`}),
        createStep('invoke_action',`${prefix}_notify`,{actionId:notification.id,actionVersion:'1',inputSource:'field',inputField:'name',nextId:''}),
        createStep('message',`${prefix}_name_missing`,{text:'Customer name is required.',nextId:''}),
        createStep('message',`${prefix}_email_missing`,{text:'Customer email is required.',nextId:''})
      ]};
    const flowUpdate={id:`workflow_acceptance_${prefix}_update`,name:'Update selected customer',
      trigger:{pageId:page.id,componentId:buttons['Update selected customer'],event:'click'},
      startStepId:`${prefix}_selected_check`,steps:[
        createStep('condition',`${prefix}_selected_check`,{operator:'selected',modelId:customerModel.id,trueId:`${prefix}_update`,falseId:`${prefix}_select_message`}),
        createStep('update',`${prefix}_update`,{modelId:customerModel.id,nextId:`${prefix}_updated_message`}),
        createStep('message',`${prefix}_updated_message`,{text:'Customer updated.',nextId:''}),
        createStep('message',`${prefix}_select_message`,{text:'Select a customer first.',nextId:''})
      ]};
    project.workflows.push(flowCreate,flowUpdate);
  }

  const orderPageId=orders.id;
  project.workflows.push({
    id:'workflow_acceptance_order_create',name:'Validate and create order',
    trigger:{pageId:orderPageId,componentId:'acceptance_order_save',event:'click'},startStepId:'order_validate_customer',steps:[
      createStep('condition','order_validate_customer',{field:'customer_id',operator:'filled',trueId:'order_validate_name',falseId:'order_missing_customer'}),
      createStep('condition','order_validate_name',{field:'order_name',operator:'filled',trueId:'order_validate_amount',falseId:'order_missing_name'}),
      createStep('condition','order_validate_amount',{field:'amount',operator:'filled',trueId:'order_create',falseId:'order_missing_amount'}),
      createStep('create','order_create',{modelId:orderModel.id,nextId:'order_notify'}),
      createStep('invoke_action','order_notify',{actionId:notification.id,actionVersion:'1',inputSource:'field',inputField:'order_name',nextId:''}),
      createStep('message','order_missing_customer',{text:'Select a customer before saving the order.',nextId:''}),
      createStep('message','order_missing_name',{text:'Order name is required.',nextId:''}),
      createStep('message','order_missing_amount',{text:'Order amount is required.',nextId:''})
    ]
  },{
    id:'workflow_acceptance_order_update',name:'Update selected order',
    trigger:{pageId:orderPageId,componentId:'acceptance_order_edit',event:'click'},startStepId:'order_selected_for_update',steps:[
      createStep('condition','order_selected_for_update',{operator:'selected',modelId:orderModel.id,trueId:'order_update',falseId:'order_select_for_update'}),
      createStep('update','order_update',{modelId:orderModel.id,nextId:'order_updated_message'}),
      createStep('message','order_updated_message',{text:'Order updated.',nextId:''}),
      createStep('message','order_select_for_update',{text:'Select an order first.',nextId:''})
    ]
  },{
    id:'workflow_acceptance_order_delete',name:'Delete selected order (admin only)',
    trigger:{pageId:orderPageId,componentId:'acceptance_order_delete',event:'click'},startStepId:'order_selected_for_delete',steps:[
      createStep('condition','order_selected_for_delete',{operator:'selected',modelId:orderModel.id,trueId:'order_delete',falseId:'order_select_for_delete'}),
      createStep('delete','order_delete',{modelId:orderModel.id,nextId:'order_deleted_message'}),
      createStep('message','order_deleted_message',{text:'Order deleted.',nextId:''}),
      createStep('message','order_select_for_delete',{text:'Select an order first.',nextId:''})
    ]
  });
  project.workflows.push({
    id:'workflow_acceptance_order_name_change',name:'Preview typed order name',
    trigger:{pageId:orderPageId,componentId:'acceptance_order_name',event:'change'},
    startStepId:'order_name_preview',steps:[
      createStep('invoke_action','order_name_preview',{actionId:notification.id,actionVersion:'1',inputSource:'event',nextId:''})
    ]
  });
  // The starter flow belongs to the old page and has no trigger in this new scenario.
  project.workflows=project.workflows.filter(item=>item.id!=='workflow_create_customer');
  return validateProject(project);
}

const isMain=process.argv[1] && new URL(import.meta.url).pathname===process.argv[1];
if(isMain) {
  const output=process.argv[2];
  if(!output||process.argv.length!==3){console.error('Usage: node scripts/generate-customer-order-acceptance.mjs /absolute/path.json');process.exitCode=2;}
  else {
    try {await writeFile(output,JSON.stringify(createAcceptanceProject(),null,2)+'\n',{flag:'wx'});
      console.log(`Wrote Customer and Order acceptance project to ${output}`);
    }catch(error){console.error(`Acceptance project generation failed: ${error.message}`);process.exitCode=1;}
  }
}

package provider

import (
	"context"
	"strings"

	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/types"

	"github.com/pertisktech/pertisk-gits/terraform-provider-pertisk-gits/internal/client"
)

var (
	_ resource.Resource                = &groupResource{}
	_ resource.ResourceWithConfigure   = &groupResource{}
	_ resource.ResourceWithImportState = &groupResource{}
)

func NewGroupResource() resource.Resource { return &groupResource{} }

type groupResource struct {
	api *client.Client
}

type groupModel struct {
	ID          types.String `tfsdk:"id"`
	Slug        types.String `tfsdk:"slug"`
	Name        types.String `tfsdk:"name"`
	Description types.String `tfsdk:"description"`
	ParentPath  types.String `tfsdk:"parent_path"`
	FullPath    types.String `tfsdk:"full_path"`
}

func (r *groupResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_group"
}

func (r *groupResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		MarkdownDescription: "A Pertisk Gits group (organization).",
		Attributes: map[string]schema.Attribute{
			"id": schema.StringAttribute{
				Computed: true,
				PlanModifiers: []planmodifier.String{
					stringplanmodifier.UseStateForUnknown(),
				},
			},
			"slug": schema.StringAttribute{
				Required:            true,
				MarkdownDescription: "URL slug for the group.",
			},
			"name": schema.StringAttribute{
				Required:            true,
				MarkdownDescription: "Display name.",
			},
			"description": schema.StringAttribute{
				Optional:            true,
				MarkdownDescription: "Optional description.",
			},
			"parent_path": schema.StringAttribute{
				Optional:            true,
				MarkdownDescription: "Parent group full path (omit for top-level).",
				PlanModifiers: []planmodifier.String{
					stringplanmodifier.RequiresReplace(),
				},
			},
			"full_path": schema.StringAttribute{
				Computed:            true,
				MarkdownDescription: "Full group path (e.g. `platform` or `platform/team`).",
				PlanModifiers: []planmodifier.String{
					stringplanmodifier.UseStateForUnknown(),
				},
			},
		},
	}
}

func (r *groupResource) Configure(_ context.Context, req resource.ConfigureRequest, resp *resource.ConfigureResponse) {
	r.api = configureClient(req.ProviderData, &resp.Diagnostics)
}

func (r *groupResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var plan groupModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	body := client.CreateOrganizationRequest{
		Name: plan.Name.ValueString(),
		Slug: plan.Slug.ValueString(),
	}
	if !plan.Description.IsNull() && !plan.Description.IsUnknown() {
		body.Description = stringPtr(plan.Description.ValueString())
	}
	if !plan.ParentPath.IsNull() && !plan.ParentPath.IsUnknown() && plan.ParentPath.ValueString() != "" {
		body.ParentPath = stringPtr(plan.ParentPath.ValueString())
	}

	org, err := r.api.CreateOrganization(ctx, body)
	if err != nil {
		resp.Diagnostics.AddError("Create group failed", err.Error())
		return
	}
	setGroupState(&plan, org)
	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *groupResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var state groupModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	fullPath := state.FullPath.ValueString()
	if fullPath == "" {
		fullPath = state.Slug.ValueString()
		if !state.ParentPath.IsNull() && state.ParentPath.ValueString() != "" {
			fullPath = strings.Trim(state.ParentPath.ValueString(), "/") + "/" + state.Slug.ValueString()
		}
	}

	org, err := r.api.GetOrganizationByPath(ctx, fullPath)
	if err != nil {
		if client.IsNotFound(err) {
			resp.State.RemoveResource(ctx)
			return
		}
		resp.Diagnostics.AddError("Read group failed", err.Error())
		return
	}
	setGroupState(&state, org)
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
}

func (r *groupResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan groupModel
	var state groupModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	body := client.UpdateOrganizationRequest{
		Name: stringPtr(plan.Name.ValueString()),
		Slug: stringPtr(plan.Slug.ValueString()),
	}
	if !plan.Description.IsNull() && !plan.Description.IsUnknown() {
		body.Description = stringPtr(plan.Description.ValueString())
	} else {
		body.Description = stringPtr("")
	}

	org, err := r.api.UpdateOrganization(ctx, state.FullPath.ValueString(), body)
	if err != nil {
		resp.Diagnostics.AddError("Update group failed", err.Error())
		return
	}
	setGroupState(&plan, org)
	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *groupResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var state groupModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	if err := r.api.DeleteOrganization(ctx, state.FullPath.ValueString()); err != nil && !client.IsNotFound(err) {
		resp.Diagnostics.AddError("Delete group failed", err.Error())
	}
}

func (r *groupResource) ImportState(ctx context.Context, req resource.ImportStateRequest, resp *resource.ImportStateResponse) {
	resource.ImportStatePassthroughID(ctx, path.Root("full_path"), req, resp)
}

func setGroupState(model *groupModel, org *client.Organization) {
	model.ID = types.StringValue(org.ID)
	model.Slug = types.StringValue(org.Slug)
	model.Name = types.StringValue(org.Name)
	model.FullPath = types.StringValue(org.FullPath)
	if org.Description != nil && *org.Description != "" {
		model.Description = types.StringValue(*org.Description)
	} else {
		model.Description = types.StringNull()
	}
	if idx := strings.LastIndex(org.FullPath, "/"); idx > 0 {
		model.ParentPath = types.StringValue(org.FullPath[:idx])
	} else if model.ParentPath.IsUnknown() {
		model.ParentPath = types.StringNull()
	}
}

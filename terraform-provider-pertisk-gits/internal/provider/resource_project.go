package provider

import (
	"context"
	"fmt"
	"strings"

	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringdefault"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/types"

	"github.com/pertisktech/pertisk-gits/terraform-provider-pertisk-gits/internal/client"
)

var (
	_ resource.Resource                = &projectResource{}
	_ resource.ResourceWithConfigure   = &projectResource{}
	_ resource.ResourceWithImportState = &projectResource{}
)

func NewProjectResource() resource.Resource { return &projectResource{} }

type projectResource struct {
	api *client.Client
}

type projectModel struct {
	ID          types.String `tfsdk:"id"`
	OrgPath     types.String `tfsdk:"org_path"`
	Slug        types.String `tfsdk:"slug"`
	Name        types.String `tfsdk:"name"`
	Description types.String `tfsdk:"description"`
	Visibility  types.String `tfsdk:"visibility"`
}

func (r *projectResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_project"
}

func (r *projectResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		MarkdownDescription: "A Pertisk Gits project (repository).",
		Attributes: map[string]schema.Attribute{
			"id": schema.StringAttribute{
				Computed: true,
				PlanModifiers: []planmodifier.String{
					stringplanmodifier.UseStateForUnknown(),
				},
			},
			"org_path": schema.StringAttribute{
				Required:            true,
				MarkdownDescription: "Parent group full path.",
				PlanModifiers: []planmodifier.String{
					stringplanmodifier.RequiresReplace(),
				},
			},
			"slug": schema.StringAttribute{
				Required:            true,
				MarkdownDescription: "Repository slug.",
				PlanModifiers: []planmodifier.String{
					stringplanmodifier.RequiresReplace(),
				},
			},
			"name": schema.StringAttribute{
				Required:            true,
				MarkdownDescription: "Display name.",
			},
			"description": schema.StringAttribute{
				Optional:            true,
				MarkdownDescription: "Optional description.",
			},
			"visibility": schema.StringAttribute{
				Optional:            true,
				Computed:            true,
				Default:             stringdefault.StaticString("private"),
				MarkdownDescription: "`private` or `public`.",
			},
		},
	}
}

func (r *projectResource) Configure(_ context.Context, req resource.ConfigureRequest, resp *resource.ConfigureResponse) {
	r.api = configureClient(req.ProviderData, &resp.Diagnostics)
}

func (r *projectResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var plan projectModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	body := client.CreateRepositoryRequest{
		Name: plan.Name.ValueString(),
		Slug: plan.Slug.ValueString(),
	}
	if !plan.Description.IsNull() && !plan.Description.IsUnknown() {
		body.Description = stringPtr(plan.Description.ValueString())
	}
	if !plan.Visibility.IsNull() && !plan.Visibility.IsUnknown() {
		body.Visibility = stringPtr(plan.Visibility.ValueString())
	}

	repo, err := r.api.CreateRepository(ctx, plan.OrgPath.ValueString(), body)
	if err != nil {
		resp.Diagnostics.AddError("Create project failed", err.Error())
		return
	}
	setProjectState(&plan, repo)
	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *projectResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var state projectModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	repo, err := r.api.GetRepository(ctx, state.OrgPath.ValueString(), state.Slug.ValueString())
	if err != nil {
		if client.IsNotFound(err) {
			resp.State.RemoveResource(ctx)
			return
		}
		resp.Diagnostics.AddError("Read project failed", err.Error())
		return
	}
	setProjectState(&state, repo)
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
}

func (r *projectResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan projectModel
	var state projectModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	body := client.UpdateRepositoryRequest{
		Name: stringPtr(plan.Name.ValueString()),
	}
	if !plan.Description.IsNull() && !plan.Description.IsUnknown() {
		body.Description = stringPtr(plan.Description.ValueString())
	} else {
		body.Description = stringPtr("")
	}
	if !plan.Visibility.IsNull() && !plan.Visibility.IsUnknown() {
		body.Visibility = stringPtr(plan.Visibility.ValueString())
	}

	repo, err := r.api.UpdateRepository(ctx, state.OrgPath.ValueString(), state.Slug.ValueString(), body)
	if err != nil {
		resp.Diagnostics.AddError("Update project failed", err.Error())
		return
	}
	plan.OrgPath = state.OrgPath
	plan.Slug = state.Slug
	setProjectState(&plan, repo)
	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *projectResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var state projectModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	if err := r.api.DeleteRepository(ctx, state.OrgPath.ValueString(), state.Slug.ValueString()); err != nil && !client.IsNotFound(err) {
		resp.Diagnostics.AddError("Delete project failed", err.Error())
	}
}

func (r *projectResource) ImportState(ctx context.Context, req resource.ImportStateRequest, resp *resource.ImportStateResponse) {
	// Import id: org_path/repo_slug (last segment is repo slug).
	id := strings.Trim(req.ID, "/")
	idx := strings.LastIndex(id, "/")
	if idx <= 0 {
		resp.Diagnostics.AddError("Invalid import id", "Use `org_path/repo_slug` (e.g. platform/app).")
		return
	}
	resp.Diagnostics.Append(resp.State.SetAttribute(ctx, path.Root("org_path"), id[:idx])...)
	resp.Diagnostics.Append(resp.State.SetAttribute(ctx, path.Root("slug"), id[idx+1:])...)
	resp.Diagnostics.Append(resp.State.SetAttribute(ctx, path.Root("id"), fmt.Sprintf("%s/%s", id[:idx], id[idx+1:]))...)
}

func setProjectState(model *projectModel, repo *client.Repository) {
	model.ID = types.StringValue(repo.ID)
	model.Slug = types.StringValue(repo.Slug)
	model.Name = types.StringValue(repo.Name)
	model.Visibility = types.StringValue(repo.Visibility)
	if repo.Description != nil && *repo.Description != "" {
		model.Description = types.StringValue(*repo.Description)
	} else {
		model.Description = types.StringNull()
	}
}

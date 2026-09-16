CREATE TRIGGER audit_m2m_applications
    AFTER INSERT OR UPDATE OR DELETE ON m2m_applications
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:id');
--> statement-breakpoint
CREATE TRIGGER audit_m2m_app_roles
    AFTER INSERT OR UPDATE OR DELETE ON m2m_app_roles
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:m2m_app_id,role_id');
--> statement-breakpoint
CREATE TRIGGER audit_m2m_applications_organizations
    AFTER INSERT OR UPDATE OR DELETE ON m2m_applications_organizations
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:m2m_app_id,organization_id');
--> statement-breakpoint
CREATE TRIGGER audit_organizations_default_roles
    AFTER INSERT OR UPDATE OR DELETE ON organizations_default_roles
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:organization_id,role_id');
